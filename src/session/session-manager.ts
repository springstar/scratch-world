import type { Agent } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import { createAgent } from "../agent/agent-factory.js";
import { trimContext } from "../agent/context-trimmer.js";
import type { ChannelGateway } from "../channels/gateway.js";
import type { ChatMessage } from "../channels/types.js";
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
		private agentTtlMs: number = DEFAULT_AGENT_TTL_MS,
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
	): Promise<void> {
		return this.enqueue(sessionId, () => this._dispatchWebChat(sessionId, userId, text, bus, images));
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
		await this.hydrateActiveScene(agent, msg.sessionId);
		this.hydrateActiveSkills(agent);

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

		try {
			await agent.prompt(msg.text);
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
	): Promise<void> {
		// Upsert session record — web sessions may not exist yet
		const existing = await this.sessionRepo.findById(sessionId);
		if (!existing) {
			await this.sessionRepo.save({
				sessionId,
				userId,
				channelId: "web",
				activeSceneId: null,
				agentMessages: "[]",
				updatedAt: Date.now(),
			});
		}

		const msg: ChatMessage = {
			sessionId,
			userId,
			channelId: "web",
			text,
			timestamp: Date.now(),
		};

		const agent = await this.getOrCreateAgent(msg);
		await this.hydrateActiveScene(agent, sessionId);
		this.hydrateActiveSkills(agent);

		let fullText = "";
		let activeSceneId: string | null = existing?.activeSceneId ?? null;
		const unsub = agent.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				const delta = event.assistantMessageEvent.delta;
				fullText += delta;
				bus.publish(sessionId, { type: "text_delta", delta });
			} else if (event.type === "tool_execution_end" && !event.isError) {
				const details = event.result?.details as { sceneId?: string; title?: string } | undefined;
				if (details?.sceneId) {
					activeSceneId = details.sceneId;
					const viewUrl = `${this.viewerBaseUrl}/scene/${details.sceneId}?session=${sessionId}`;
					bus.publish(sessionId, {
						type: "scene_created",
						sceneId: details.sceneId,
						title: details.title ?? details.sceneId,
						viewUrl,
					});
				}
			}
		});

		try {
			const imageContents: ImageContent[] | undefined = images?.map((img) => ({
				type: "image" as const,
				data: img.base64,
				mimeType: img.mimeType,
			}));
			await agent.prompt(text, imageContents);
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
		await this.hydrateActiveScene(agent, sessionId);
		this.hydrateActiveSkills(agent);

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
		const agent = createAgent(this.sceneManager, msg.userId, this.viewerBaseUrl, msg.sessionId);

		if (record?.agentMessages) {
			try {
				const messages = JSON.parse(record.agentMessages);
				agent.replaceMessages(messages);
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

	private async hydrateActiveScene(agent: Agent, sessionId: string): Promise<void> {
		const record = await this.sessionRepo.findById(sessionId);
		if (!record?.activeSceneId) return;
		const scene = await this.sceneManager.getScene(record.activeSceneId);
		if (!scene) return;
		const base = agent.state.systemPrompt.split("\n\nActive scene:")[0];
		agent.setSystemPrompt(`${base}\n\nActive scene: ${scene.sceneId} ("${scene.title}")`);
	}

	private hydrateActiveSkills(agent: Agent): void {
		let prompt = agent.state.systemPrompt
			.split("\n\n## Scene Generation")[0]
			.split("\n\n## Renderer Capabilities")[0]
			.split("\n\n## Three.js Reference")[0];

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
