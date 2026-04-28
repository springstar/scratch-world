import { Hono } from "hono";
import { normalizeMemory } from "../../npcs/memory.js";
import { buildPerceptionContext, extractSceneCaption } from "../../npcs/npc-perception.js";
import { greetAsNpc } from "../../npcs/npc-runner.js";
import type { SceneManager } from "../../scene/scene-manager.js";
import type { RealtimeBus } from "../realtime.js";

interface NpcGreetBody {
	sessionId: string;
	sceneId: string;
	npcObjectId: string;
	playerPosition?: { x: number; y: number; z: number };
}

export function npcGreetRoute(sceneManager: SceneManager, bus: RealtimeBus): Hono {
	const app = new Hono();

	app.post("/", async (c) => {
		let body: NpcGreetBody;
		try {
			body = await c.req.json<NpcGreetBody>();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const { sessionId, sceneId, npcObjectId, playerPosition } = body;
		if (!sessionId || !sceneId || !npcObjectId) {
			return c.json({ error: "Missing required fields: sessionId, sceneId, npcObjectId" }, 400);
		}

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		const npcObj = scene.sceneData.objects.find((o) => o.objectId === npcObjectId && o.type === "npc");
		if (!npcObj) return c.json({ error: "NPC not found in scene" }, 404);

		const personality = (npcObj.metadata.npcPersonality as string | undefined) ?? "一个普通的村民";
		const memory = normalizeMemory(npcObj.metadata.npcMemory);

		const perceptionContext = buildPerceptionContext(
			npcObj,
			scene.sceneData.objects,
			playerPosition,
			scene.sceneData.environment,
			extractSceneCaption(scene.sceneData.objects),
		);

		// Fire-and-forget — respond immediately, greeting arrives via realtime bus
		greetAsNpc(npcObj.objectId, npcObj.name, personality, memory, perceptionContext)
			.then((text) => {
				if (!text) return;
				bus.publish(sessionId, {
					type: "npc_speech",
					npcId: npcObj.objectId,
					npcName: npcObj.name,
					text,
					sceneId,
				});
			})
			.catch((err: unknown) => {
				console.error("[npc-greet] greetAsNpc error:", err);
			});

		return c.json({ ok: true });
	});

	return app;
}
