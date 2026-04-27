import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { behaviorRegistry } from "../../behaviors/registry.js";
import { fixGeneratedCode } from "../../behaviors/skills/code-gen.js";
import { applyEvolutionDelta, type EvolutionLogEntry } from "../../npcs/npc-evolution.js";
import type { SceneManager } from "../../scene/scene-manager.js";
import type { SessionManager } from "../../session/session-manager.js";
import type { RealtimeBus } from "../realtime.js";
import { generatePropRoute } from "./generate-prop.js";

export function scenesRoute(
	sceneManager: SceneManager,
	projectRoot: string,
	bus: RealtimeBus,
	sessionManager?: SessionManager,
): Hono {
	const app = new Hono();

	// GET /scenes — list all scenes for the active provider
	app.get("/", async (c) => {
		const scenes = await sceneManager.listScenes();
		return c.json({
			scenes: scenes.map((s) => {
				// thumbnailUrl may be stored at top level (new scenes) or in the terrain
				// object's metadata (older scenes written before the column was added).
				const metaThumb = s.sceneData.objects[0]?.metadata?.thumbnailUrl;
				const thumbnailUrl = s.thumbnailUrl ?? (typeof metaThumb === "string" && metaThumb ? metaThumb : null);
				return {
					sceneId: s.sceneId,
					title: s.title,
					status: s.status ?? "ready",
					createdAt: s.createdAt,
					updatedAt: s.updatedAt,
					thumbnailUrl,
					provider: s.providerRef.provider,
					splatUrl: s.sceneData.splatUrl ?? null,
				};
			}),
		});
	});

	// GET /scenes/:sceneId — viewer fetches scene data on mount.
	// No auth: all scenes are openly readable by sceneId.
	// (Access control lives at the channel/agent layer, not the viewer API.)
	app.get("/:sceneId", async (c) => {
		const { sceneId } = c.req.param();
		const tokenParam = c.req.query("token");

		let scene = tokenParam ? await sceneManager.getSceneByShareToken(tokenParam) : null;

		if (!scene) {
			const byId = await sceneManager.getScene(sceneId);
			if (!byId) return c.json({ error: "Scene not found" }, 404);
			scene = byId;
		}

		if (scene.sceneId !== sceneId) return c.json({ error: "Scene not found" }, 404);

		// Sync active scene for the session so the agent always operates on the scene the viewer is showing.
		const sessionParam = c.req.query("session");
		if (sessionParam && sessionManager) {
			sessionManager.setActiveScene(sessionParam, sceneId).catch(() => {});
		}

		return c.json({
			sceneId: scene.sceneId,
			title: scene.title,
			description: scene.description,
			version: scene.version,
			status: scene.status ?? "ready",
			sceneData: scene.sceneData,
			providerRef: {
				provider: scene.providerRef.provider,
				viewUrl: scene.providerRef.viewUrl,
				// editToken intentionally omitted — viewer has no need for it
			},
		});
	});

	// POST /scenes/:sceneId/panorama — set equirectangular skybox
	// Accepts:
	//   multipart/form-data  { file: <image> }  → uploads to /uploads/panoramas/
	//   application/json     { url: string }    → uses the URL directly
	app.post("/:sceneId/panorama", async (c) => {
		const { sceneId } = c.req.param();
		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		let skyboxUrl: string;

		const contentType = c.req.header("content-type") ?? "";
		if (contentType.includes("multipart/form-data")) {
			const form = await c.req.formData();
			const file = form.get("file") as File | null;
			if (!file) return c.json({ error: "Missing 'file' field" }, 400);

			const ext = file.name.split(".").pop() ?? "jpg";
			const filename = `${sceneId}.${ext}`;
			const uploadsDir = join(projectRoot, "uploads", "panoramas");
			await mkdir(uploadsDir, { recursive: true });
			await writeFile(join(uploadsDir, filename), Buffer.from(await file.arrayBuffer()));
			skyboxUrl = `/uploads/panoramas/${filename}`;
		} else {
			const body = await c.req.json<{ url?: string }>();
			if (!body?.url) return c.json({ error: "Missing 'url' field" }, 400);
			skyboxUrl = body.url;
		}

		const merged = {
			...scene.sceneData,
			environment: { ...scene.sceneData.environment, skyboxUrl },
		};
		const updated = await sceneManager.updateScene(sceneId, "Set panorama skybox", merged);

		return c.json({ sceneId: updated.sceneId, version: updated.version, skyboxUrl });
	});

	// POST /scenes/:sceneId/props — add a physical prop directly without going through the agent.
	// Body: { name, description, modelUrl, physicsShape?, mass?, scale?, placement? }
	app.post("/:sceneId/props", async (c) => {
		const { sceneId } = c.req.param();
		const sessionParam = c.req.query("session");

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		const body = await c.req.json<{
			name?: string;
			description?: string;
			modelUrl?: string;
			physicsShape?: string;
			mass?: number;
			scale?: number;
			placement?: string;
			playerPosition?: { x: number; y: number; z: number };
		}>();
		if (!body.name || !body.description || !body.modelUrl) {
			return c.json({ error: "Missing required fields: name, description, modelUrl" }, 400);
		}

		const objectId = `prop_${randomUUID().slice(0, 8)}`;
		const newObject = {
			objectId,
			name: body.name,
			type: "prop" as const,
			position: body.playerPosition ?? { x: 0, y: 0, z: 0 },
			description: body.description,
			interactable: true,
			metadata: {
				modelUrl: body.modelUrl,
				physicsShape: body.physicsShape ?? "box",
				mass: body.mass ?? 10,
				scale: body.scale ?? 1,
				placement: body.placement ?? "near_camera",
				...(body.playerPosition ? { playerPosition: body.playerPosition } : {}),
			},
		};

		const updated = await sceneManager.addPropsToScene(sceneId, [newObject]);
		bus.publish(sessionParam!, { type: "scene_updated", sceneId: updated.sceneId, version: updated.version });

		return c.json({ ok: true, objectId, version: updated.version });
	});

	// DELETE /scenes/:sceneId/props/:propId — remove a physical prop.
	app.delete("/:sceneId/props/:propId", async (c) => {
		const { sceneId, propId } = c.req.param();
		const sessionParam = c.req.query("session");

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		try {
			const updated = await sceneManager.removePropFromScene(sceneId, propId);
			bus.publish(sessionParam!, { type: "scene_updated", sceneId: updated.sceneId, version: updated.version });
			return c.json({ ok: true, version: updated.version });
		} catch (err) {
			const status = (err as { status?: number }).status ?? 500;
			return c.json({ error: err instanceof Error ? err.message : "Failed to remove prop" }, status as 404 | 500);
		}
	});

	// ── NPC endpoints ─────────────────────────────────────────────────────────

	// POST /scenes/:sceneId/npcs — add an NPC directly to the scene.
	app.post("/:sceneId/npcs", async (c) => {
		const { sceneId } = c.req.param();
		const sessionParam = c.req.query("session");

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		const body = await c.req.json<{
			name?: string;
			personality?: string;
			traits?: string;
			skills?: string[];
			modelUrl?: string;
			scale?: number;
			targetHeight?: number;
			placement?: string;
			playerPosition?: { x: number; y: number; z: number };
			cameraForward?: { x: number; z: number };
		}>();
		if (!body.name || !body.personality || !body.modelUrl) {
			return c.json({ error: "Missing required fields: name, personality, modelUrl" }, 400);
		}

		// Reject duplicate NPC names in the same scene
		const nameLower = body.name.toLowerCase();
		const duplicate = scene.sceneData.objects.find((o) => o.type === "npc" && o.name.toLowerCase() === nameLower);
		if (duplicate) {
			return c.json({ error: `场景中已存在名为「${body.name}」的 NPC` }, 409);
		}

		const objectId = `npc_${randomUUID().slice(0, 8)}`;
		const newNpc = {
			objectId,
			name: body.name,
			type: "npc" as const,
			position: body.playerPosition ?? { x: 0, y: 0, z: 0 },
			description: body.personality,
			interactable: true,
			interactionHint: `与${body.name}对话`,
			metadata: {
				npcPersonality: body.personality,
				npcTraits: body.traits ?? "",
				npcSkills: body.skills ?? [],
				modelUrl: body.modelUrl,
				physicsShape: "box",
				mass: 10,
				scale: body.scale ?? 1,
				...(body.targetHeight !== undefined ? { targetHeight: body.targetHeight } : {}),
				placement: body.placement ?? "near_camera",
				...(body.playerPosition ? { playerPosition: body.playerPosition } : {}),
				...(body.cameraForward ? { cameraForward: body.cameraForward } : {}),
			},
		};

		const updated = await sceneManager.addPropsToScene(sceneId, [newNpc]);
		bus.publish(sessionParam!, { type: "scene_updated", sceneId: updated.sceneId, version: updated.version });
		return c.json({ ok: true, objectId, version: updated.version });
	});

	// PATCH /scenes/:sceneId/npcs/:npcId — update NPC name, personality, or traits.
	app.patch("/:sceneId/npcs/:npcId", async (c) => {
		const { sceneId, npcId } = c.req.param();
		const sessionParam = c.req.query("session");

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		const body = await c.req.json<{ name?: string; personality?: string; traits?: string; skills?: string[] }>();
		const metadataPatch: Record<string, unknown> = {};
		if (body.personality !== undefined) metadataPatch.npcPersonality = body.personality;
		if (body.traits !== undefined) metadataPatch.npcTraits = body.traits;
		if (body.skills !== undefined) metadataPatch.npcSkills = body.skills;

		try {
			const updated = await sceneManager.updateSceneObject(sceneId, npcId, {
				...(body.name !== undefined ? { name: body.name, description: body.personality ?? undefined } : {}),
				...(Object.keys(metadataPatch).length > 0 ? { metadata: metadataPatch } : {}),
			});
			bus.publish(sessionParam!, { type: "scene_updated", sceneId: updated.sceneId, version: updated.version });
			return c.json({ ok: true, version: updated.version });
		} catch (err) {
			const status = (err as { status?: number }).status ?? 500;
			return c.json({ error: err instanceof Error ? err.message : "Failed to update NPC" }, status as 404 | 500);
		}
	});

	// DELETE /scenes/:sceneId/npcs/:npcId — remove an NPC from the scene.
	app.delete("/:sceneId/npcs/:npcId", async (c) => {
		const { sceneId, npcId } = c.req.param();
		const sessionParam = c.req.query("session");

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		try {
			const updated = await sceneManager.removePropFromScene(sceneId, npcId);
			bus.publish(sessionParam!, { type: "scene_updated", sceneId: updated.sceneId, version: updated.version });
			return c.json({ ok: true, version: updated.version });
		} catch (err) {
			const status = (err as { status?: number }).status ?? 500;
			return c.json({ error: err instanceof Error ? err.message : "Failed to remove NPC" }, status as 404 | 500);
		}
	});

	// POST /scenes/:sceneId/portals — add a portal to the scene.
	// Body: { name?, targetSceneId?, targetSceneName?, playerPosition? }
	app.post("/:sceneId/portals", async (c) => {
		const { sceneId } = c.req.param();
		const sessionParam = c.req.query("session");

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		const body = await c.req.json<{
			name?: string;
			targetSceneId?: string;
			targetSceneName?: string;
			playerPosition?: { x: number; y: number; z: number };
		}>();

		const objectId = `portal_${randomUUID().slice(0, 8)}`;
		const newPortal = {
			objectId,
			name: body.name ?? "传送门",
			type: "portal" as const,
			position: body.playerPosition ?? { x: 0, y: 0, z: 0 },
			description: body.targetSceneName ? `前往 ${body.targetSceneName}` : "通往另一个世界的门",
			interactable: true,
			interactionHint: body.targetSceneName ? `进入传送门 → ${body.targetSceneName}` : "进入传送门",
			metadata: {
				placement: body.playerPosition ? "exact" : "near_camera",
				...(body.playerPosition ? { playerPosition: body.playerPosition } : {}),
				...(body.targetSceneId ? { targetSceneId: body.targetSceneId } : {}),
				...(body.targetSceneName ? { targetSceneName: body.targetSceneName } : {}),
			},
		};

		const updated = await sceneManager.addPropsToScene(sceneId, [newPortal]);
		bus.publish(sessionParam!, { type: "scene_updated", sceneId: updated.sceneId, version: updated.version });
		return c.json({ ok: true, objectId, version: updated.version });
	});

	// DELETE /scenes/:sceneId/portals/:portalId — remove a portal from the scene.
	app.delete("/:sceneId/portals/:portalId", async (c) => {
		const { sceneId, portalId } = c.req.param();
		const sessionParam = c.req.query("session");

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		try {
			const updated = await sceneManager.removePropFromScene(sceneId, portalId);
			bus.publish(sessionParam!, { type: "scene_updated", sceneId: updated.sceneId, version: updated.version });
			return c.json({ ok: true, version: updated.version });
		} catch (err) {
			const status = (err as { status?: number }).status ?? 500;
			return c.json({ error: err instanceof Error ? err.message : "Failed to remove portal" }, status as 404 | 500);
		}
	});

	// PATCH /scenes/:sceneId/objects/:objectId — lock a resolved position back to the object.
	// Called fire-and-forget by the viewer after resolvePosition() to prevent position drift.
	// Body: { placement: "exact"; playerPosition: { x: number; y: number; z: number } }
	app.patch("/:sceneId/objects/:objectId", async (c) => {
		const { sceneId, objectId } = c.req.param();

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		const body = await c.req.json<{
			placement?: string;
			playerPosition?: { x: number; y: number; z: number };
			skillConfig?: Record<string, unknown>;
			displayY?: number;
		}>();
		if (!body.placement || !body.playerPosition) {
			return c.json({ error: "Missing required fields: placement, playerPosition" }, 400);
		}

		try {
			const obj = scene.sceneData.objects.find((o) => o.objectId === objectId);
			const existingSkill = obj?.metadata?.skill as Record<string, unknown> | undefined;
			const skillPatch: Record<string, unknown> | undefined =
				body.skillConfig && existingSkill
					? {
							skill: {
								...existingSkill,
								config: { ...((existingSkill.config as Record<string, unknown>) ?? {}), ...body.skillConfig },
							},
						}
					: undefined;

			const displayYPatch: Record<string, unknown> =
				typeof body.displayY === "number" ? { displayY: body.displayY } : {};

			const updated = await sceneManager.updateSceneObject(sceneId, objectId, {
				position: body.playerPosition,
				metadata: {
					placement: body.placement,
					playerPosition: body.playerPosition,
					...displayYPatch,
					...skillPatch,
				},
			});
			return c.json({ ok: true, version: updated.version });
		} catch (err) {
			const status = (err as { status?: number }).status ?? 500;
			return c.json({ error: err instanceof Error ? err.message : "Failed to update object" }, status as 404 | 500);
		}
	});

	// ── NPC evolution endpoints ────────────────────────────────────────────────

	// GET /scenes/:sceneId/npcs/:npcId/evolution — list evolution log entries
	app.get("/:sceneId/npcs/:npcId/evolution", async (c) => {
		const { sceneId, npcId } = c.req.param();
		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);
		const npcObj = scene.sceneData.objects.find((o) => o.objectId === npcId && o.type === "npc");
		if (!npcObj) return c.json({ error: "NPC not found" }, 404);
		const log: EvolutionLogEntry[] = (() => {
			const raw = npcObj.metadata.npcEvolutionLog;
			if (!Array.isArray(raw)) return [];
			return raw as EvolutionLogEntry[];
		})();
		return c.json({
			npcId,
			interactionCount:
				typeof npcObj.metadata.npcInteractionCount === "number" ? npcObj.metadata.npcInteractionCount : 0,
			log,
		});
	});

	// POST /scenes/:sceneId/npcs/:npcId/evolution/:entryId/approve — apply a pending evolution
	app.post("/:sceneId/npcs/:npcId/evolution/:entryId/approve", async (c) => {
		const { sceneId, npcId, entryId } = c.req.param();

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		const npcObj = scene.sceneData.objects.find((o) => o.objectId === npcId && o.type === "npc");
		if (!npcObj) return c.json({ error: "NPC not found" }, 404);

		const log: EvolutionLogEntry[] = (() => {
			const raw = npcObj.metadata.npcEvolutionLog;
			if (!Array.isArray(raw)) return [];
			return raw as EvolutionLogEntry[];
		})();
		const entry = log.find((e) => e.id === entryId);
		if (!entry) return c.json({ error: "Evolution entry not found" }, 404);
		if (entry.status !== "pending") return c.json({ error: "Entry already resolved" }, 409);

		const currentPersonality = (npcObj.metadata.npcPersonality as string | undefined) ?? "一个普通的村民";
		const newPersonality = await applyEvolutionDelta(npcObj.name, currentPersonality, entry.suggestedDelta);

		const updatedLog = log.map((e) =>
			e.id === entryId ? { ...e, status: "approved" as const, appliedAt: Date.now() } : e,
		);
		try {
			const updated = await sceneManager.updateSceneObject(sceneId, npcId, {
				metadata: { npcPersonality: newPersonality, npcEvolutionLog: updatedLog },
			});
			return c.json({ ok: true, newPersonality, version: updated.version });
		} catch (err) {
			const status = (err as { status?: number }).status ?? 500;
			return c.json(
				{ error: err instanceof Error ? err.message : "Failed to apply evolution" },
				status as 404 | 500,
			);
		}
	});

	// POST /scenes/:sceneId/npcs/:npcId/evolution/:entryId/reject — discard a pending evolution
	app.post("/:sceneId/npcs/:npcId/evolution/:entryId/reject", async (c) => {
		const { sceneId, npcId, entryId } = c.req.param();

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		const npcObj = scene.sceneData.objects.find((o) => o.objectId === npcId && o.type === "npc");
		if (!npcObj) return c.json({ error: "NPC not found" }, 404);

		const log: EvolutionLogEntry[] = (() => {
			const raw = npcObj.metadata.npcEvolutionLog;
			if (!Array.isArray(raw)) return [];
			return raw as EvolutionLogEntry[];
		})();
		const entry = log.find((e) => e.id === entryId);
		if (!entry) return c.json({ error: "Evolution entry not found" }, 404);
		if (entry.status !== "pending") return c.json({ error: "Entry already resolved" }, 409);

		const updatedLog = log.map((e) => (e.id === entryId ? { ...e, status: "rejected" as const } : e));
		try {
			const updated = await sceneManager.updateSceneObject(sceneId, npcId, {
				metadata: { npcEvolutionLog: updatedLog },
			});
			return c.json({ ok: true, version: updated.version });
		} catch (err) {
			const status = (err as { status?: number }).status ?? 500;
			return c.json(
				{ error: err instanceof Error ? err.message : "Failed to reject evolution" },
				status as 404 | 500,
			);
		}
	});

	// DELETE /scenes/:sceneId — permanently delete a scene (owner only)
	app.delete("/:sceneId", async (c) => {
		const { sceneId } = c.req.param();
		const sessionParam = c.req.query("session");
		const sessionUserId = sessionParam?.startsWith("web:") ? sessionParam.slice(4) : null;
		if (!sessionUserId) return c.json({ error: "Missing ?session=web:<userId> query param" }, 401);
		try {
			await sceneManager.deleteScene(sceneId, sessionUserId);
			return c.json({ ok: true });
		} catch (err) {
			const status = (err as { status?: number }).status ?? 500;
			return c.json(
				{ error: err instanceof Error ? err.message : "Failed to delete scene" },
				status as 403 | 404 | 500,
			);
		}
	});

	// Mount prop generation sub-router
	app.route("/:sceneId/generate-prop", generatePropRoute(join(projectRoot, "uploads")));

	// POST /scenes/:sceneId/objects/:objectId/fix-skill — patch syntax/runtime error in cached code
	// Single Haiku call: fix only the error, keep all existing logic intact.
	app.post("/:sceneId/objects/:objectId/fix-skill", async (c) => {
		const { sceneId, objectId } = c.req.param();
		const sessionParam = c.req.query("session");
		const body = await c.req.json<{ error: string }>().catch(() => ({ error: "" }));
		if (!body.error) return c.json({ error: "Missing error field" }, 400);

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);
		const obj = scene.sceneData.objects.find((o) => o.objectId === objectId);
		if (!obj) return c.json({ error: "Object not found" }, 404);

		const existingSkill = obj.metadata?.skill as Record<string, unknown> | undefined;
		if (!existingSkill || existingSkill.name !== "code-gen")
			return c.json({ error: "Object has no code-gen skill" }, 400);
		const existingConfig = (existingSkill.config ?? {}) as Record<string, unknown>;
		const brokenCode = typeof existingConfig.cachedCode === "string" ? existingConfig.cachedCode : null;
		if (!brokenCode) return c.json({ error: "No cached code to fix" }, 400);

		if (sessionParam) {
			bus.publish(sessionParam, {
				type: "skill_generating",
				objectId,
				objectName: obj.name,
				sceneId,
				skillName: "code-gen",
			});
		}

		(async () => {
			try {
				const fixedCode = await fixGeneratedCode(brokenCode, body.error);
				const saved = await sceneManager.updateSceneObject(sceneId, objectId, {
					metadata: { skill: { name: "code-gen", config: { ...existingConfig, cachedCode: fixedCode } } },
				});
				if (sessionParam) {
					bus.publish(sessionParam, { type: "skill_ready", objectId, sceneId });
					bus.publish(sessionParam, { type: "scene_updated", sceneId, version: saved.version });
				}
				console.log(`[fix-skill] patched ${objectId}: ${body.error}`);
			} catch (err) {
				console.error(`[fix-skill] failed for ${objectId}:`, err);
				if (sessionParam) bus.publish(sessionParam, { type: "skill_ready", objectId, sceneId });
			}
		})();

		return c.json({ ok: true });
	});

	// POST /scenes/:sceneId/objects/:objectId/regen-skill — update prompt and re-run code-gen in background
	app.post("/:sceneId/objects/:objectId/regen-skill", async (c) => {
		const { sceneId, objectId } = c.req.param();
		const sessionParam = c.req.query("session");
		const body = await c.req.json<{ prompt?: string }>().catch(() => ({ prompt: undefined }));

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);
		const obj = scene.sceneData.objects.find((o) => o.objectId === objectId);
		if (!obj) return c.json({ error: "Object not found" }, 404);

		const existingSkill = obj.metadata?.skill as Record<string, unknown> | undefined;
		if (!existingSkill || existingSkill.name !== "code-gen")
			return c.json({ error: "Object has no code-gen skill" }, 400);

		const existingConfig = (existingSkill.config ?? {}) as Record<string, unknown>;
		const newPrompt = body.prompt ?? (existingConfig.prompt as string | undefined) ?? "";

		// Clear cachedCode and update prompt, then kick off background generation
		const updatedConfig = { ...existingConfig, prompt: newPrompt, cachedCode: undefined, autoRun: true };
		delete updatedConfig.cachedCode;
		const updated = await sceneManager.updateSceneObject(sceneId, objectId, {
			metadata: { skill: { name: "code-gen", config: updatedConfig } },
		});

		if (sessionParam) {
			bus.publish(sessionParam, {
				type: "skill_generating",
				objectId,
				objectName: obj.name,
				sceneId,
				skillName: "code-gen",
			});
			bus.publish(sessionParam, { type: "scene_updated", sceneId, version: updated.version });
		}

		// Background generation
		(async () => {
			const freshScene = await sceneManager.getScene(sceneId);
			const freshObj = freshScene?.sceneData.objects.find((o) => o.objectId === objectId);
			try {
				const display = await behaviorRegistry.run({
					objectId,
					objectName: freshObj?.name ?? objectId,
					sceneId,
					objectPosition: freshObj?.position ?? { x: 0, y: 0, z: 0 },
					environment: freshScene?.sceneData.environment,
					displayY:
						typeof freshObj?.metadata?.displayY === "number" ? (freshObj.metadata.displayY as number) : 1.3,
					displayWidth: 1.6,
					displayHeight: 0.9,
					config: { name: "code-gen", config: updatedConfig },
				});
				if (display?.type === "script") {
					const saved = await sceneManager.updateSceneObject(sceneId, objectId, {
						metadata: { skill: { name: "code-gen", config: { ...updatedConfig, cachedCode: display.code } } },
					});
					if (sessionParam) {
						bus.publish(sessionParam, { type: "skill_ready", objectId, sceneId });
						bus.publish(sessionParam, { type: "scene_updated", sceneId, version: saved.version });
					}
					console.log(`[regen-skill] done for ${objectId}`);
				}
			} catch (err) {
				console.error(`[regen-skill] failed for ${objectId}:`, err);
				if (sessionParam) bus.publish(sessionParam, { type: "skill_ready", objectId, sceneId });
			}
		})();

		return c.json({ ok: true, version: updated.version });
	});

	// DELETE /scenes/:sceneId/objects/:objectId/skill — remove code-gen skill from object
	app.delete("/:sceneId/objects/:objectId/skill", async (c) => {
		const { sceneId, objectId } = c.req.param();
		const sessionParam = c.req.query("session");

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);
		const obj = scene.sceneData.objects.find((o) => o.objectId === objectId);
		if (!obj) return c.json({ error: "Object not found" }, 404);

		// Strip skill and interactionHint from metadata
		const { skill: _skill, ...restMeta } = (obj.metadata ?? {}) as Record<string, unknown>;
		const updated = await sceneManager.updateSceneObject(sceneId, objectId, {
			interactionHint: undefined as unknown as string,
			metadata: { ...restMeta, skill: null },
		});

		if (sessionParam) {
			bus.publish(sessionParam, { type: "scene_updated", sceneId, version: updated.version });
		}
		return c.json({ ok: true, version: updated.version });
	});

	return app;
}
