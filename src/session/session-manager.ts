import type { Agent } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";
import { BASE_SYSTEM_PROMPT, createAgent, PROVIDER_BASE_PROMPT } from "../agent/agent-factory.js";
import { trimContext } from "../agent/context-trimmer.js";
import { isRejectionSignal, logFeedback } from "../agent/feedback-logger.js";
import type { ChannelGateway } from "../channels/gateway.js";
import type { ChatMessage } from "../channels/types.js";
import type { GenerationQueue } from "../generation/generation-queue.js";
import type { SceneManager } from "../scene/scene-manager.js";
import type { SkillLoader } from "../skills/skill-loader.js";
import type { SessionRepository } from "../storage/types.js";
import type { RealtimeBus } from "../viewer-api/realtime.js";

const DEFAULT_AGENT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SWEEP_INTERVAL_MS = 60 * 1000; // sweep at most once per minute

interface CacheEntry {
	agent: Agent;
	lastAccess: number;
}

export class SessionManager {
	private agents = new Map<string, CacheEntry>();
	private lastSweepAt = 0;
	// Per-session serial queue: sessionId → always-resolving tail promise
	private queues = new Map<string, Promise<void>>();

	constructor(
		private gateway: ChannelGateway,
		private sceneManager: SceneManager,
		private sessionRepo: SessionRepository,
		private viewerBaseUrl: string,
		private skillLoader: SkillLoader,
		private generationQueue: GenerationQueue,
		private projectRoot: string = process.cwd(),
		private agentTtlMs: number = DEFAULT_AGENT_TTL_MS,
		private bus?: RealtimeBus,
		_publicUploadsUrl?: string,
	) {}

	dispatch(msg: ChatMessage): Promise<void> {
		return this.enqueue(msg.sessionId, () => this._dispatch(msg));
	}

	dispatchViewerInteraction(sessionId: string, sceneId: string, text: string, bus: RealtimeBus): Promise<void> {
		return this.enqueue(sessionId, () => this._dispatchViewerInteraction(sessionId, sceneId, text, bus));
	}

	dispatchWebChat(
		sessionId: string,
		userId: string,
		text: string,
		bus: RealtimeBus,
		images?: Array<{ base64: string; mimeType: string }>,
		playerPosition?: { x: number; y: number; z: number },
		clickPosition?: { x: number; y: number; z: number },
		viewerSceneId?: string,
		mediaFiles?: Array<{ filePath: string; publicUrl: string; mimeType: string; kind: "image" | "video" }>,
	): Promise<void> {
		return this.enqueue(sessionId, () =>
			this._dispatchWebChat(
				sessionId,
				userId,
				text,
				bus,
				images,
				playerPosition,
				clickPosition,
				viewerSceneId,
				mediaFiles,
			),
		);
	}

	/** Update the active scene for a session — called when the viewer loads a scene. */
	async setActiveScene(sessionId: string, sceneId: string): Promise<void> {
		const existing = await this.sessionRepo.findById(sessionId);
		if (!existing || existing.activeSceneId === sceneId) return;
		await this.sessionRepo.save({ ...existing, activeSceneId: sceneId, updatedAt: Date.now() });
	}

	// ── Private helpers ──────────────────────────────────────────────────────

	/** Serialize tasks for a session; errors in one task don't block the next. */
	private enqueue(sessionId: string, fn: () => Promise<void>): Promise<void> {
		const gate = (this.queues.get(sessionId) ?? Promise.resolve()).catch(() => {});
		const next = gate.then(fn);
		const silenced = next.catch(() => {});
		this.queues.set(sessionId, silenced);
		silenced.then(() => {
			if (this.queues.get(sessionId) === silenced) this.queues.delete(sessionId);
		});
		return next;
	}

	private async _dispatch(msg: ChatMessage): Promise<void> {
		const agent = await this.getOrCreateAgent(msg);
		await this.hydrateSystemPrompt(agent, msg.sessionId);

		// Seed activeSceneId from persisted record so it survives turns where no scene tool runs
		const record = await this.sessionRepo.findById(msg.sessionId);
		let activeSceneId: string | null = record?.activeSceneId ?? null;

		let reply = "";
		const updatedScenes: Array<{ sceneId: string; title: string }> = [];

		const unsub = agent.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				reply += event.assistantMessageEvent.delta;
			} else if (event.type === "tool_execution_end" && !event.isError) {
				const details = event.result?.details as { sceneId?: string; title?: string } | undefined;
				if (details?.sceneId) {
					activeSceneId = details.sceneId;
					if (event.toolName === "create_scene" || event.toolName === "update_scene") {
						if (details.title) updatedScenes.push({ sceneId: details.sceneId, title: details.title });
					}
				}
			}
		});

		// Save uploaded images to disk, build context prefix and ImageContent array for agent
		type ImageEntry = ImageContent & { filePath: string };
		let contextPrefix = "";
		let imageContents: ImageContent[] | undefined;
		if (msg.media && msg.media.length > 0) {
			const photosDir = join(this.projectRoot, "uploads", "photos");
			await mkdir(photosDir, { recursive: true });
			const entries: ImageEntry[] = [];
			for (const m of msg.media) {
				if (m.type !== "image" || !m.data) continue;
				const ext = m.mimeType === "image/png" ? "png" : m.mimeType === "image/webp" ? "webp" : "jpg";
				const fileName = `${randomUUID()}.${ext}`;
				const filePath = join(photosDir, fileName);
				await writeFile(filePath, m.data);
				const publicUrl = `${this.viewerBaseUrl}/uploads/photos/${fileName}`;
				contextPrefix += `[上传图片: path=${filePath}, url=${publicUrl}]\n`;
				entries.push({ type: "image" as const, data: m.data.toString("base64"), mimeType: m.mimeType, filePath });
			}
			if (entries.length > 0) {
				imageContents = entries.map(({ type, data, mimeType }) => ({ type, data, mimeType }));
			}
		}

		const promptText = contextPrefix ? `${contextPrefix}${msg.text}` : msg.text;

		try {
			await agent.prompt(promptText, imageContents);
		} finally {
			unsub();
		}

		if (reply.trim()) {
			await this.gateway.sendText(msg.channelId, msg.userId, reply);
		}

		for (const { sceneId, title } of updatedScenes) {
			const viewerUrl = `${this.viewerBaseUrl}/scene/${sceneId}?session=${msg.sessionId}`;
			await this.gateway.presentScene(msg.channelId, msg.userId, title, viewerUrl);
		}

		await this.saveSession(msg, agent, activeSceneId);
	}

	private async _dispatchWebChat(
		sessionId: string,
		userId: string,
		text: string,
		bus: RealtimeBus,
		images?: Array<{ base64: string; mimeType: string }>,
		playerPosition?: { x: number; y: number; z: number },
		clickPosition?: { x: number; y: number; z: number },
		viewerSceneId?: string,
		mediaFiles?: Array<{ filePath: string; publicUrl: string; mimeType: string; kind: "image" | "video" }>,
	): Promise<void> {
		console.log(
			`[SessionManager] _dispatchWebChat sessionId=${sessionId} viewerSceneId=${viewerSceneId ?? "(none)"}`,
		);
		// Upsert session record — web sessions may not exist yet
		let existing: Awaited<ReturnType<typeof this.sessionRepo.findById>>;
		try {
			existing = await this.sessionRepo.findById(sessionId);
			console.log(`[SessionManager] findById done, existing=${!!existing}`);
		} catch (err) {
			console.error("[SessionManager] sessionRepo.findById threw:", err);
			throw err;
		}
		if (!existing) {
			await this.sessionRepo.save({
				sessionId,
				userId,
				channelId: "web",
				activeSceneId: null,
				agentMessages: "[]",
				updatedAt: Date.now(),
			});
			existing = await this.sessionRepo.findById(sessionId);
		}

		// If the viewer reports a scene the session doesn't know about yet, sync it now
		// so hydrateSystemPrompt sees the correct active scene.
		if (viewerSceneId && existing?.activeSceneId !== viewerSceneId) {
			await this.sessionRepo.save({
				...(existing ?? { sessionId, userId, channelId: "web", agentMessages: "[]" }),
				sessionId,
				activeSceneId: viewerSceneId,
				updatedAt: Date.now(),
			});
			// Refresh local reference so activeSceneId below is also in sync
			if (existing) existing = { ...existing, activeSceneId: viewerSceneId };
		}

		const msg: ChatMessage = {
			sessionId,
			userId,
			channelId: "web",
			text,
			timestamp: Date.now(),
		};

		const agent = await this.getOrCreateAgent(msg);
		console.log("[SessionManager] agent ready");
		await this.hydrateSystemPrompt(agent, sessionId);
		console.log("[SessionManager] hydrateSystemPrompt done");

		let fullText = "";
		let activeSceneId: string | null = existing?.activeSceneId ?? null;
		const unsub = agent.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				const delta = event.assistantMessageEvent.delta;
				fullText += delta;
				bus.publish(sessionId, { type: "text_delta", delta });
			} else if (event.type === "tool_execution_end" && !event.isError) {
				const details = event.result?.details as
					| { sceneId?: string; title?: string; generating?: boolean; sceneChanged?: boolean }
					| undefined;
				if (details?.sceneId) {
					activeSceneId = details.sceneId;
					// Async paths (Marble/LLM provider): GenerationQueue will publish scene_created when ready.
					// Only publish immediately for sync paths (sceneData provided, or StubProvider).
					if (!details.generating) {
						if (details.sceneChanged) {
							// Prop added or scene modified in-place (e.g. place_prop, remove_prop).
							// Hot-update the viewer without triggering a full scene reload.
							void this.sceneManager.getScene(details.sceneId).then((updated) => {
								if (updated) {
									bus.publish(sessionId, {
										type: "scene_updated",
										sceneId: details.sceneId as string,
										version: updated.version,
									});
								}
							});
						} else {
							const viewUrl = `${this.viewerBaseUrl}/scene/${details.sceneId}?session=${sessionId}`;
							bus.publish(sessionId, {
								type: "scene_created",
								sceneId: details.sceneId,
								title: details.title ?? details.sceneId,
								viewUrl,
							});
						}
					}
				}
			}
		});
		try {
			// Compress images before sending to LLM — large photos (5MB+) cause stream timeouts.
			// Resize to max 1280px on longest edge, re-encode as JPEG ≤80% quality.
			const imageContents: ImageContent[] | undefined = images
				? await Promise.all(
						images.map(async (img) => {
							const buf = Buffer.from(img.base64, "base64");
							const compressed = await sharp(buf)
								.resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
								.jpeg({ quality: 80 })
								.toBuffer();
							const beforeKB = Math.round(buf.length / 1024);
							const afterKB = Math.round(compressed.length / 1024);
							console.log(`[SessionManager] image compressed ${beforeKB}KB → ${afterKB}KB`);
							return { type: "image" as const, data: compressed.toString("base64"), mimeType: "image/jpeg" };
						}),
					)
				: undefined;
			// Log rejection signals for skill evolution before the agent processes them
			if (text && isRejectionSignal(text)) {
				logFeedback({
					ts: Date.now(),
					source: "user_rejection",
					sceneId: existing?.activeSceneId ?? null,
					sessionId,
					data: { text },
				});
			}
			// Save uploaded images to disk and inject file paths into the prompt
			// so the image_to_3d tool can read them by path.
			// Skip if mediaFiles already covers the same images (pre-uploaded via /media-upload)
			// to avoid injecting duplicate [上传图片: path=...] entries into the context.
			let contextPrefix = "";
			const mediaFileImages = mediaFiles?.filter((f) => f.kind === "image") ?? [];
			const skipInlineImages = mediaFileImages.length > 0 && images && mediaFileImages.length >= images.length;
			if (images && images.length > 0 && !skipInlineImages) {
				const photosDir = join(this.projectRoot, "uploads", "photos");
				await mkdir(photosDir, { recursive: true });
				for (const img of images) {
					const ext = img.mimeType === "image/png" ? "png" : img.mimeType === "image/webp" ? "webp" : "jpg";
					const fileName = `${randomUUID()}.${ext}`;
					const filePath = join(photosDir, fileName);
					await writeFile(filePath, Buffer.from(img.base64, "base64"));
					const publicUrl = `${this.viewerBaseUrl}/uploads/photos/${fileName}`;
					contextPrefix += `[上传图片: path=${filePath}, url=${publicUrl}]\n`;
				}
			}
			// Inject pre-uploaded media files (images via /media-upload, videos)
			if (mediaFiles && mediaFiles.length > 0) {
				for (const mf of mediaFiles) {
					if (mf.kind === "video") {
						contextPrefix += `[上传视频: path=${mf.filePath}]\n`;
					} else {
						contextPrefix += `[上传图片: path=${mf.filePath}]\n`;
					}
				}
			}
			// Prepend player position and click target as spatial context
			if (playerPosition) {
				contextPrefix += `[玩家当前位置: x=${playerPosition.x.toFixed(1)}, y=${playerPosition.y.toFixed(1)}, z=${playerPosition.z.toFixed(1)}]\n`;
			}
			if (clickPosition) {
				contextPrefix += `[点击目标: x=${clickPosition.x.toFixed(2)}, y=${clickPosition.y.toFixed(2)}, z=${clickPosition.z.toFixed(2)}]\n`;
			}
			const hasMedia = (images && images.length > 0) || (mediaFiles && mediaFiles.length > 0);
			const hasVideo = mediaFiles?.some((f) => f.kind === "video");
			const effectiveText =
				!text?.trim() && hasMedia ? (hasVideo ? "根据上传的视频生成场景" : "根据上传的图片生成场景") : text;
			const promptText = contextPrefix ? `${contextPrefix}${effectiveText}` : effectiveText;
			console.log(
				`[SessionManager] promptText=${JSON.stringify(promptText.slice(0, 200))} imageCount=${imageContents?.length ?? 0}`,
			);
			console.log("[SessionManager] calling agent.prompt");
			await agent.prompt(promptText, imageContents);
			console.log("[SessionManager] agent.prompt done");
			console.log("[SessionManager] agent reply:", fullText.slice(0, 200));
		} finally {
			// Always publish text_done so the client's isTyping indicator always resets,
			// even if agent.prompt() threw (e.g., API unreachable, tool execution error).
			bus.publish(sessionId, { type: "text_done", text: fullText });
			unsub();
		}

		await this.saveSession(msg, agent, activeSceneId);
	}

	// Called by the Viewer API when a user interacts with an object in the viewer.
	// Text deltas are streamed to the viewer via RealtimeBus instead of the chat channel.
	private async _dispatchViewerInteraction(
		sessionId: string,
		sceneId: string,
		text: string,
		bus: RealtimeBus,
	): Promise<void> {
		const record = await this.sessionRepo.findById(sessionId);
		if (!record) throw new Error(`Session not found: ${sessionId}`);

		const msg: ChatMessage = {
			sessionId,
			userId: record.userId,
			channelId: record.channelId,
			text,
			timestamp: Date.now(),
		};

		const agent = await this.getOrCreateAgent(msg);
		await this.hydrateSystemPrompt(agent, sessionId);

		// Stream text deltas to viewer via WebSocket
		let fullText = "";
		let sceneChangedId: string | null = null;
		const unsub = agent.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				const delta = event.assistantMessageEvent.delta;
				fullText += delta;
				bus.publish(sessionId, { type: "text_delta", delta });
			} else if (event.type === "tool_execution_end" && !event.isError) {
				const details = event.result?.details as { sceneId?: string; sceneChanged?: boolean } | undefined;
				if (details?.sceneChanged && details.sceneId) {
					sceneChangedId = details.sceneId;
				}
			}
		});

		try {
			await agent.prompt(text);
			bus.publish(sessionId, { type: "text_done", text: fullText });
			if (sceneChangedId) {
				const updated = await this.sceneManager.getScene(sceneChangedId);
				if (updated) {
					bus.publish(sessionId, { type: "scene_updated", sceneId: sceneChangedId, version: updated.version });
				}
			}
		} finally {
			unsub();
		}

		// The sceneId the viewer is currently showing becomes the active scene
		await this.saveSession(msg, agent, sceneId);
	}

	private async getOrCreateAgent(msg: ChatMessage): Promise<Agent> {
		this.evictExpired();

		const entry = this.agents.get(msg.sessionId);
		if (entry) {
			entry.lastAccess = Date.now();
			return entry.agent;
		}

		const record = await this.sessionRepo.findById(msg.sessionId);
		const agent = createAgent(
			this.sceneManager,
			msg.userId,
			this.viewerBaseUrl,
			msg.sessionId,
			null,
			this.generationQueue,
			this.projectRoot,
			this.bus,
		);

		if (record?.agentMessages) {
			try {
				const messages = JSON.parse(record.agentMessages);
				// Don't restore history from a previous session that ran under a different
				// generation mode. If the provider now handles generation (startGeneration),
				// old messages that show sceneCode calls would push the agent back to that path.
				const providerHandlesGeneration = !!this.sceneManager.getActiveProvider().providesOwnRendering;
				if (!providerHandlesGeneration) {
					agent.replaceMessages(messages);
				}
			} catch {
				// Corrupt history — start fresh
			}
		}

		this.agents.set(msg.sessionId, { agent, lastAccess: Date.now() });
		return agent;
	}

	private evictExpired(): void {
		const now = Date.now();
		if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
		this.lastSweepAt = now;
		for (const [sessionId, entry] of this.agents) {
			if (now - entry.lastAccess > this.agentTtlMs) {
				this.agents.delete(sessionId);
			}
		}
	}

	private async hydrateSystemPrompt(agent: Agent, sessionId: string): Promise<void> {
		const activeProvider = this.sceneManager.getActiveProvider();
		const providerHandlesGeneration = !!activeProvider.providesOwnRendering;

		// Select the correct base prompt — never append to an unknown previous state
		let prompt = providerHandlesGeneration ? PROVIDER_BASE_PROMPT : BASE_SYSTEM_PROMPT;

		// Append active scene context
		const record = await this.sessionRepo.findById(sessionId);
		if (record?.activeSceneId) {
			const scene = await this.sceneManager.getScene(record.activeSceneId);
			if (scene) {
				prompt += `\n\nActive scene: ${scene.sceneId} ("${scene.title}")`;
			}
		}

		// In LLM code-gen mode: append generator + renderer + Three.js skills
		if (!providerHandlesGeneration) {
			const generatorMd = this.skillLoader.getActivePromptMarkdown("generator");
			if (generatorMd) {
				prompt += `\n\n## Scene Generation\n\n${generatorMd}`;
			}
			const rendererMd = this.skillLoader.getActivePromptMarkdown("renderer");
			if (rendererMd) {
				prompt += `\n\n## Renderer Capabilities\n\n${rendererMd}`;
			}
			const threejsMd = this.skillLoader.getThreejsMarkdown();
			if (threejsMd) {
				prompt += `\n\n## Three.js Reference\n\n${threejsMd}`;
			}
		}

		agent.setSystemPrompt(prompt);
	}

	private async saveSession(msg: ChatMessage, agent: Agent, activeSceneId: string | null): Promise<void> {
		// Trim to MAX_TURNS before persisting to prevent unbounded history growth.
		// Also strip image data from non-recent messages — images are already processed
		// by the model and do not need to be re-sent on future turns.
		const trimmed = trimContext(agent.state.messages as Parameters<typeof trimContext>[0]);
		const lastUserIdx = [...trimmed].reverse().findIndex((m) => (m as { role?: string }).role === "user");
		const lastUserAbsIdx = lastUserIdx === -1 ? -1 : trimmed.length - 1 - lastUserIdx;
		const stripped = trimmed.map((m, i) => {
			if (
				(m as { role?: string }).role === "user" &&
				i !== lastUserAbsIdx &&
				Array.isArray((m as { content?: unknown }).content)
			) {
				const content = (m as { content: unknown[] }).content.filter(
					(c) => (c as { type?: string }).type !== "image",
				);
				return { ...m, content };
			}
			return m;
		});
		await this.sessionRepo.save({
			sessionId: msg.sessionId,
			userId: msg.userId,
			channelId: msg.channelId,
			activeSceneId,
			agentMessages: JSON.stringify(stripped),
			updatedAt: Date.now(),
		});
	}
}
