import { Hono } from "hono";
import { normalizeMemory } from "../../npcs/memory.js";
import { runNpcAgent } from "../../npcs/npc-agent.js";
import { createNpcEvolutionEvent, generateEvolutionDiff, selectEvolutionStrategy } from "../../npcs/npc-evolution.js";
import { buildPerceptionContext, extractSceneCaption } from "../../npcs/npc-perception.js";
import { reactAsNpc, spontaneousNpcLine, updateMemory } from "../../npcs/npc-runner.js";
import type { SceneManager } from "../../scene/scene-manager.js";
import type { SceneObject } from "../../scene/types.js";
import type { NpcEvolutionRepository, WorldEventRepository } from "../../storage/types.js";
import { generateWorldEvent, makeWorldEventId } from "../../world/event-generator.js";
import type { RealtimeBus } from "../realtime.js";

// Number of interactions before a reflection job is triggered
const EVOLUTION_THRESHOLD = 20;
// Number of interactions before a world event is triggered
const WORLD_EVENT_THRESHOLD = 5;

// Keywords that indicate an action request — route to agent loop instead of fast reactAsNpc
const ACTION_PATTERN =
	/去|走|过来|跟我|找|移动|带我|带路|看看|查看|做个|表演|鞠躬|挥手|你能|请你|帮我|go|come|move|find|show|look at/i;

interface NpcInteractBody {
	sessionId: string;
	sceneId: string;
	npcObjectId: string;
	userText: string;
	playerPosition?: { x: number; y: number; z: number };
	chatHistory?: { role: "user" | "npc"; text: string }[];
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
		const bystanderMemory = normalizeMemory(bystander.metadata.npcMemory);
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

export function npcInteractRoute(
	sceneManager: SceneManager,
	bus: RealtimeBus,
	eventStore?: WorldEventRepository,
	evolutionRepo?: NpcEvolutionRepository,
): Hono {
	const app = new Hono();

	app.post("/", async (c) => {
		let body: NpcInteractBody;
		try {
			body = await c.req.json<NpcInteractBody>();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const { sessionId, sceneId, npcObjectId, userText, playerPosition, chatHistory } = body;
		if (!sessionId || !sceneId || !npcObjectId || !userText?.trim()) {
			return c.json({ error: "Missing required fields: sessionId, sceneId, npcObjectId, userText" }, 400);
		}

		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		const npcObj = scene.sceneData.objects.find((o) => o.objectId === npcObjectId && o.type === "npc");
		if (!npcObj) return c.json({ error: "NPC not found in scene" }, 404);

		const personality = (npcObj.metadata.npcPersonality as string | undefined) ?? "一个普通的村民";
		// Read persisted memory (stored as JSON array in metadata; default empty)
		const memory = normalizeMemory(npcObj.metadata.npcMemory);
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

					const metadataPatch: Record<string, unknown> = {
						npcInteractionCount: newCount,
						npcLastInteractedAt: Date.now(),
					};
					if (updatedMemory.length !== memory.length) {
						metadataPatch.npcMemory = updatedMemory;
					}

					if (newCount % EVOLUTION_THRESHOLD === 0) {
						const strategy = selectEvolutionStrategy(newCount);
						const diff = await generateEvolutionDiff(npcObj.name, personality, updatedMemory, strategy);
						if (diff) {
							if (evolutionRepo) {
								const evt = createNpcEvolutionEvent(
									npcObj.objectId,
									sceneId,
									"interaction",
									strategy,
									newCount,
									personality,
									diff,
								);
								await evolutionRepo.addEvent(evt).catch((err: unknown) => {
									console.error("[npc-interact] evolution repo write failed:", err);
								});
							}
						}
					}

					// Player-triggered world event: every WORLD_EVENT_THRESHOLD interactions with this NPC
					if (eventStore && newCount % WORLD_EVENT_THRESHOLD === 0) {
						const recentEvents = await eventStore.getRecentEvents(sceneId, 3);
						const eventData = await generateWorldEvent(scene, recentEvents);
						if (eventData) {
							const worldEvent = {
								eventId: makeWorldEventId(),
								sceneId,
								createdAt: Date.now(),
								...eventData,
							};
							await eventStore.addEvent(worldEvent);
							bus.publish(sessionId, {
								type: "world_event",
								sceneId,
								eventId: worldEvent.eventId,
								worldTime: worldEvent.worldTime,
								eventType: worldEvent.eventType,
								headline: worldEvent.headline,
								body: worldEvent.body,
							});
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
			// Fast path — single Haiku call with full conversation context
			reactAsNpc(npcObj.objectId, npcObj.name, personality, userText, memory, perceptionContext, chatHistory)
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
