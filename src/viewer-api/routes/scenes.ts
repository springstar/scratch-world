import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { applyEvolutionDelta, type EvolutionLogEntry } from "../../npcs/npc-evolution.js";
import type { SceneManager } from "../../scene/scene-manager.js";
import type { RealtimeBus } from "../realtime.js";

export function scenesRoute(sceneManager: SceneManager, projectRoot: string, bus: RealtimeBus): Hono {
	const app = new Hono();

	// GET /scenes?session=web:<userId> — list all scenes for this user
	app.get("/", async (c) => {
		const session = c.req.query("session");
		const userId = session?.startsWith("web:") ? session.slice(4) : null;
		if (!userId) return c.json({ error: "session required" }, 401);
		const scenes = await sceneManager.listScenes(userId);
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
				};
			}),
		});
	});

	// GET /scenes/:sceneId — viewer fetches scene data on mount
	// Access granted if:  is_public=true  OR  ?token=<share_token>  OR  called by the owner (no auth on viewer — open by token only)
	app.get("/:sceneId", async (c) => {
		const { sceneId } = c.req.param();
		const tokenParam = c.req.query("token");
		const sessionParam = c.req.query("session");

		// Extract userId from web session format "web:<userId>"
		const sessionUserId = sessionParam?.startsWith("web:") ? sessionParam.slice(4) : null;

		let scene = tokenParam ? await sceneManager.getSceneByShareToken(tokenParam) : null;

		if (!scene) {
			const byId = await sceneManager.getScene(sceneId);
			if (!byId) return c.json({ error: "Scene not found" }, 404);

			const isOwner = sessionUserId !== null && byId.ownerId === sessionUserId;
			const hasShareToken = !!tokenParam && byId.shareToken === tokenParam;

			if (!byId.isPublic && !isOwner && !hasShareToken) {
				return c.json({ error: "Forbidden" }, 403);
			}
			scene = byId;
		}

		if (scene.sceneId !== sceneId) return c.json({ error: "Scene not found" }, 404);
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
	// Auth: same as GET (?session=web:<userId> required, must be owner).
	// Body: { name, description, modelUrl, physicsShape?, mass?, scale?, placement? }
	app.post("/:sceneId/props", async (c) => {
		const { sceneId } = c.req.param();
		const sessionParam = c.req.query("session");
		const sessionUserId = sessionParam?.startsWith("web:") ? sessionParam.slice(4) : null;
		if (!sessionUserId) return c.json({ error: "Missing ?session=web:<userId> query param" }, 401);

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);
		if (!scene.isPublic && scene.ownerId !== sessionUserId) {
			return c.json({ error: "Forbidden" }, 403);
		}

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
			position: { x: 0, y: 0, z: 0 },
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
	// Auth: same as POST (?session=web:<userId> required, must be owner or public scene).
	app.delete("/:sceneId/props/:propId", async (c) => {
		const { sceneId, propId } = c.req.param();
		const sessionParam = c.req.query("session");
		const sessionUserId = sessionParam?.startsWith("web:") ? sessionParam.slice(4) : null;
		if (!sessionUserId) return c.json({ error: "Missing ?session=web:<userId> query param" }, 401);

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);
		if (!scene.isPublic && scene.ownerId !== sessionUserId) {
			return c.json({ error: "Forbidden" }, 403);
		}

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
		const sessionUserId = sessionParam?.startsWith("web:") ? sessionParam.slice(4) : null;
		if (!sessionUserId) return c.json({ error: "Missing ?session=web:<userId> query param" }, 401);

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);
		if (!scene.isPublic && scene.ownerId !== sessionUserId) {
			return c.json({ error: "Forbidden" }, 403);
		}

		const body = await c.req.json<{
			name?: string;
			personality?: string;
			traits?: string;
			modelUrl?: string;
			scale?: number;
			placement?: string;
			playerPosition?: { x: number; y: number; z: number };
		}>();
		if (!body.name || !body.personality || !body.modelUrl) {
			return c.json({ error: "Missing required fields: name, personality, modelUrl" }, 400);
		}

		const objectId = `npc_${randomUUID().slice(0, 8)}`;
		const newNpc = {
			objectId,
			name: body.name,
			type: "npc" as const,
			position: { x: 0, y: 0, z: 0 },
			description: body.personality,
			interactable: true,
			interactionHint: `与${body.name}对话`,
			metadata: {
				npcPersonality: body.personality,
				npcTraits: body.traits ?? "",
				modelUrl: body.modelUrl,
				physicsShape: "box",
				mass: 10,
				scale: body.scale ?? 1,
				placement: body.placement ?? "near_camera",
				...(body.playerPosition ? { playerPosition: body.playerPosition } : {}),
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
		const sessionUserId = sessionParam?.startsWith("web:") ? sessionParam.slice(4) : null;
		if (!sessionUserId) return c.json({ error: "Missing ?session=web:<userId> query param" }, 401);

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);
		if (!scene.isPublic && scene.ownerId !== sessionUserId) {
			return c.json({ error: "Forbidden" }, 403);
		}

		const body = await c.req.json<{ name?: string; personality?: string; traits?: string }>();
		const metadataPatch: Record<string, unknown> = {};
		if (body.personality !== undefined) metadataPatch.npcPersonality = body.personality;
		if (body.traits !== undefined) metadataPatch.npcTraits = body.traits;

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
		const sessionUserId = sessionParam?.startsWith("web:") ? sessionParam.slice(4) : null;
		if (!sessionUserId) return c.json({ error: "Missing ?session=web:<userId> query param" }, 401);

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);
		if (!scene.isPublic && scene.ownerId !== sessionUserId) {
			return c.json({ error: "Forbidden" }, 403);
		}

		try {
			const updated = await sceneManager.removePropFromScene(sceneId, npcId);
			bus.publish(sessionParam!, { type: "scene_updated", sceneId: updated.sceneId, version: updated.version });
			return c.json({ ok: true, version: updated.version });
		} catch (err) {
			const status = (err as { status?: number }).status ?? 500;
			return c.json({ error: err instanceof Error ? err.message : "Failed to remove NPC" }, status as 404 | 500);
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
		const sessionParam = c.req.query("session");
		const sessionUserId = sessionParam?.startsWith("web:") ? sessionParam.slice(4) : null;
		if (!sessionUserId) return c.json({ error: "Missing ?session=web:<userId> query param" }, 401);

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);
		if (scene.ownerId !== sessionUserId) return c.json({ error: "Forbidden" }, 403);

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
		const sessionParam = c.req.query("session");
		const sessionUserId = sessionParam?.startsWith("web:") ? sessionParam.slice(4) : null;
		if (!sessionUserId) return c.json({ error: "Missing ?session=web:<userId> query param" }, 401);

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);
		if (scene.ownerId !== sessionUserId) return c.json({ error: "Forbidden" }, 403);

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

	return app;
}
