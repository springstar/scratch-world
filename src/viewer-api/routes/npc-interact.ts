import { Hono } from "hono";
import { runNpcAgent } from "../../npcs/npc-agent.js";
import { createEvolutionEntry, type EvolutionLogEntry, generateEvolutionDiff } from "../../npcs/npc-evolution.js";
import { buildPerceptionContext, extractSceneCaption } from "../../npcs/npc-perception.js";
import { reactAsNpc, spontaneousNpcLine, updateMemory } from "../../npcs/npc-runner.js";
import type { SceneManager } from "../../scene/scene-manager.js";
import type { SceneObject } from "../../scene/types.js";
import type { RealtimeBus } from "../realtime.js";

// Number of interactions before a reflection job is triggered
const EVOLUTION_THRESHOLD = 20;

// Keywords that indicate an action request — route to agent loop instead of fast reactAsNpc
const ACTION_PATTERN =
	/去|走|过来|跟我|找|移动|带我|带路|看看|查看|做个|表演|鞠躬|挥手|你能|请你|帮我|go|come|move|find|show|look at/i;

interface NpcInteractBody {
	sessionId: string;
	sceneId: string;
	npcObjectId: string;
	userText: string;
	playerPosition?: { x: number; y: number; z: number };
}

// Radius within which other NPCs can "hear" an interaction
const PERCEPTION_RADIUS = 15;

function dist2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
	const dx = a.x - b.x;
	const dz = a.z - b.z;
	return Math.sqrt(dx * dx + dz * dz);
}

/**
 * After an NPC responds, nearby NPCs may independently react (15% chance each).
 * Fire-and-forget — does not block the response.
 */
function triggerPerceptionBus(
	speakingNpc: SceneObject,
	allObjects: SceneObject[],
	playerText: string,
	npcReply: string,
	sessionId: string,
	sceneId: string,
	bus: RealtimeBus,
): void {
	const bystanders = allObjects.filter(
		(o) =>
			o.objectId !== speakingNpc.objectId &&
			o.type === "npc" &&
			typeof o.metadata?.npcPersonality === "string" &&
			dist2d(speakingNpc.position, o.position) <= PERCEPTION_RADIUS,
	);

	for (const bystander of bystanders) {
		if (Math.random() > 0.15) continue;
		const bystanderPersonality = (bystander.metadata.npcPersonality as string) ?? "一个普通的村民";
		const bystanderMemory: string[] = (() => {
			const raw = bystander.metadata.npcMemory;
			if (!Array.isArray(raw)) return [];
			return raw.filter((x): x is string => typeof x === "string");
		})();
		const perceptionNote = `附近的 ${speakingNpc.name} 正在和玩家对话。玩家说："${playerText.slice(0, 50)}"，${speakingNpc.name} 回应："${npcReply.slice(0, 50)}"`;

		spontaneousNpcLine(bystander.objectId, bystander.name, bystanderPersonality, bystanderMemory, perceptionNote)
			.then((text) => {
				if (!text) return;
				bus.publish(sessionId, {
					type: "npc_speech",
					npcId: bystander.objectId,
					npcName: bystander.name,
					text,
					sceneId,
				});
			})
			.catch((err: unknown) => {
				console.error("[npc-interact] perception bus error:", err);
			});
	}
}

export function npcInteractRoute(sceneManager: SceneManager, bus: RealtimeBus): Hono {
	const app = new Hono();

	app.post("/", async (c) => {
		let body: NpcInteractBody;
		try {
			body = await c.req.json<NpcInteractBody>();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const { sessionId, sceneId, npcObjectId, userText, playerPosition } = body;
		if (!sessionId || !sceneId || !npcObjectId || !userText?.trim()) {
			return c.json({ error: "Missing required fields: sessionId, sceneId, npcObjectId, userText" }, 400);
		}

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		const npcObj = scene.sceneData.objects.find((o) => o.objectId === npcObjectId && o.type === "npc");
		if (!npcObj) return c.json({ error: "NPC not found in scene" }, 404);

		const personality = (npcObj.metadata.npcPersonality as string | undefined) ?? "一个普通的村民";
		// Read persisted memory (stored as JSON array in metadata; default empty)
		const memory: string[] = (() => {
			const raw = npcObj.metadata.npcMemory;
			if (!Array.isArray(raw)) return [];
			return raw.filter((x): x is string => typeof x === "string");
		})();
		// Read assigned skill IDs
		const skillIds: string[] = (() => {
			const raw = npcObj.metadata.npcSkills;
			if (!Array.isArray(raw)) return [];
			return raw.filter((x): x is string => typeof x === "string");
		})();

		const perceptionContext = buildPerceptionContext(
			npcObj,
			scene.sceneData.objects,
			playerPosition,
			scene.sceneData.environment,
			extractSceneCaption(scene.sceneData.objects),
		);

		// Route: action keywords → agent loop (speak/move/emote/observe); otherwise → fast path
		const useAgentLoop = ACTION_PATTERN.test(userText);

		const handlePostInteraction = (spokenText: string) => {
			// Trigger PerceptionBus — bystander NPCs may react
			triggerPerceptionBus(npcObj, scene.sceneData.objects, userText, spokenText, sessionId, sceneId, bus);

			// Fire-and-forget: update memory, increment counter, maybe trigger evolution
			updateMemory(npcObj.name, memory, userText, spokenText)
				.then(async (updatedMemory) => {
					const prevCount =
						typeof npcObj.metadata.npcInteractionCount === "number" ? npcObj.metadata.npcInteractionCount : 0;
					const newCount = prevCount + 1;

					const metadataPatch: Record<string, unknown> = { npcInteractionCount: newCount };
					if (updatedMemory.length !== memory.length || updatedMemory.some((m, i) => m !== memory[i])) {
						metadataPatch.npcMemory = updatedMemory;
					}

					if (newCount % EVOLUTION_THRESHOLD === 0) {
						const diff = await generateEvolutionDiff(npcObj.name, personality, updatedMemory);
						if (diff) {
							const existingLog: EvolutionLogEntry[] = (() => {
								const raw = npcObj.metadata.npcEvolutionLog;
								if (!Array.isArray(raw)) return [];
								return raw as EvolutionLogEntry[];
							})();
							const entry = createEvolutionEntry(personality, diff, newCount);
							metadataPatch.npcEvolutionLog = [...existingLog, entry];
						}
					}

					return sceneManager.updateSceneObject(sceneId, npcObjectId, { metadata: metadataPatch });
				})
				.catch((err: unknown) => {
					console.error("[npc-interact] post-interaction update failed:", err);
				});
		};

		if (useAgentLoop) {
			// Agent loop — NPC can speak, move, emote, observe; captures first spoken text for memory
			let firstSpoken = "";
			const patchedBus = {
				...bus,
				publish: (sid: string, event: Parameters<typeof bus.publish>[1]) => {
					if (event.type === "npc_speech" && !firstSpoken) firstSpoken = event.text;
					bus.publish(sid, event);
				},
			} as typeof bus;

			runNpcAgent({
				npcId: npcObj.objectId,
				npcName: npcObj.name,
				personality,
				memory,
				skillIds,
				perceptionContext,
				userText,
				sceneObjects: scene.sceneData.objects,
				sessionId,
				sceneId,
				bus: patchedBus,
			})
				.then(() => {
					if (firstSpoken) handlePostInteraction(firstSpoken);
				})
				.catch((err: unknown) => {
					console.error("[npc-interact] agent loop error:", err);
				});
		} else {
			// Fast path — single Haiku call
			reactAsNpc(npcObj.objectId, npcObj.name, personality, userText, memory, perceptionContext)
				.then((text) => {
					if (!text) return;
					bus.publish(sessionId, {
						type: "npc_speech",
						npcId: npcObj.objectId,
						npcName: npcObj.name,
						text,
						sceneId,
					});
					handlePostInteraction(text);
				})
				.catch((err: unknown) => {
					console.error("[npc-interact] reactAsNpc error:", err);
				});
		}

		return c.json({ ok: true });
	});

	return app;
}
