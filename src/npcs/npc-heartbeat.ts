import type { SceneManager } from "../scene/scene-manager.js";
import type { NpcEvolutionRepository, WorldEventRepository } from "../storage/types.js";
import type { RealtimeBus } from "../viewer-api/realtime.js";
import { generateWorldEvent, makeWorldEventId } from "../world/event-generator.js";
import { normalizeMemory } from "./memory.js";
import { applyEvolutionDelta, createNpcEvolutionEvent, generateEvolutionDiff } from "./npc-evolution.js";
import { buildPerceptionContext, extractSceneCaption } from "./npc-perception.js";
import { reactAsNpcNoCD, spontaneousNpcLine } from "./npc-runner.js";

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SPONTANEOUS_CHANCE = 0.15; // 15% per NPC per tick
const DIALOGUE_CHANCE = 0.4; // 40% chance of NPC-to-NPC exchange when 2+ NPCs present

const STAGNATION_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const STAGNATION_REPAIR_MS = 7 * 24 * 60 * 60 * 1000; // 7 days → repair evolution
const STAGNATION_FAREWELL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days → farewell world_event

/**
 * Start the NPC world heartbeat.
 * Every TICK_INTERVAL_MS, for each session with an active WebSocket connection,
 * picks the most recently updated scene, randomly selects one NPC, and with
 * SPONTANEOUS_CHANCE probability generates a spontaneous one-liner published
 * via the realtime bus.
 *
 * Returns a stop function that cancels the interval.
 */
export function startNpcHeartbeat(
	sceneManager: SceneManager,
	bus: RealtimeBus,
	eventStore?: WorldEventRepository,
): () => void {
	const timer = setInterval(() => {
		void tick(sceneManager, bus, eventStore);
	}, TICK_INTERVAL_MS);

	// Prevent the interval from keeping the process alive
	timer.unref?.();

	return () => clearInterval(timer);
}

async function tick(sceneManager: SceneManager, bus: RealtimeBus, eventStore?: WorldEventRepository): Promise<void> {
	const sessions = bus.activeSessions();
	if (sessions.length === 0) return;

	await Promise.allSettled(sessions.map((sessionId) => tickSession(sceneManager, bus, sessionId, eventStore)));
}

async function tickSession(
	sceneManager: SceneManager,
	bus: RealtimeBus,
	sessionId: string,
	eventStore?: WorldEventRepository,
): Promise<void> {
	// Only bother if the session is still connected
	if (!bus.hasSubscribers(sessionId)) return;

	// Get scenes for this session, most recently updated first
	const scenes = await sceneManager.listScenes();
	if (scenes.length === 0) return;

	scenes.sort((a, b) => b.updatedAt - a.updatedAt);
	const scene = scenes[0];

	const npcs = scene.sceneData.objects.filter(
		(o) => o.type === "npc" && (o.interactable || typeof o.metadata?.npcPersonality === "string"),
	);
	if (npcs.length === 0) return;

	const env = scene.sceneData.environment;
	const sceneCaption = extractSceneCaption(scene.sceneData.objects);
	const recentWorldEvents = eventStore
		? (await eventStore.getRecentEvents(scene.sceneId, 2)).map((e) => e.headline)
		: undefined;

	// With 2+ NPCs, 40% chance of generating a short NPC-to-NPC exchange
	if (npcs.length >= 2 && Math.random() < DIALOGUE_CHANCE) {
		// Pick two distinct NPCs at random
		const shuffled = [...npcs].sort(() => Math.random() - 0.5);
		const npcA = shuffled[0];
		const npcB = shuffled[1];

		const personalityA = (npcA.metadata.npcPersonality as string | undefined) ?? "一个普通的村民";
		const personalityB = (npcB.metadata.npcPersonality as string | undefined) ?? "一个普通的村民";
		const memoryA = normalizeMemory(npcA.metadata.npcMemory);
		const memoryB = normalizeMemory(npcB.metadata.npcMemory);

		const perceptionA = buildPerceptionContext(
			npcA,
			scene.sceneData.objects,
			undefined,
			env,
			sceneCaption,
			recentWorldEvents,
		);
		const perceptionB = buildPerceptionContext(
			npcB,
			scene.sceneData.objects,
			undefined,
			env,
			sceneCaption,
			recentWorldEvents,
		);

		try {
			// NPC A initiates
			const lineA = await reactAsNpcNoCD(
				npcA.objectId,
				npcA.name,
				personalityA,
				`（你看到了${npcB.name}，主动打个招呼或说一句话）`,
				memoryA,
				perceptionA,
			);
			if (!lineA) return;

			bus.publish(sessionId, {
				type: "npc_speech",
				npcId: npcA.objectId,
				npcName: npcA.name,
				text: lineA,
				sceneId: scene.sceneId,
			});

			// Brief pause before B replies, then NPC B responds
			await new Promise((r) => setTimeout(r, 2500));
			const lineB = await reactAsNpcNoCD(
				npcB.objectId,
				npcB.name,
				personalityB,
				`${npcA.name}说："${lineA}"`,
				memoryB,
				perceptionB,
			);
			if (!lineB) return;

			bus.publish(sessionId, {
				type: "npc_speech",
				npcId: npcB.objectId,
				npcName: npcB.name,
				text: lineB,
				sceneId: scene.sceneId,
			});
		} catch (err) {
			console.error("[npc-heartbeat] npc-to-npc exchange failed:", err);
		}
		return;
	}

	// Single NPC spontaneous monologue
	const candidate = npcs[Math.floor(Math.random() * npcs.length)];
	if (Math.random() > SPONTANEOUS_CHANCE) return;

	const personality = (candidate.metadata.npcPersonality as string | undefined) ?? "一个普通的村民";
	const memory = normalizeMemory(candidate.metadata.npcMemory);

	const perceptionContext = buildPerceptionContext(
		candidate,
		scene.sceneData.objects,
		undefined,
		env,
		sceneCaption,
		recentWorldEvents,
	);

	try {
		const text = await spontaneousNpcLine(candidate.objectId, candidate.name, personality, memory, perceptionContext);
		if (!text) return;

		bus.publish(sessionId, {
			type: "npc_speech",
			npcId: candidate.objectId,
			npcName: candidate.name,
			text,
			sceneId: scene.sceneId,
		});
	} catch (err) {
		console.error("[npc-heartbeat] spontaneous line failed:", err);
	}
}

/**
 * Start the NPC stagnation checker. Runs every hour.
 * - 7+ days no interaction: auto-apply "repair" evolution to make NPC more engaging.
 * - 14+ days no interaction: publish a farewell world_event and mark NPC as departed.
 */
export function startNpcStagnationChecker(
	sceneManager: SceneManager,
	bus: RealtimeBus,
	eventStore?: WorldEventRepository,
	evolutionRepo?: NpcEvolutionRepository,
): () => void {
	const timer = setInterval(() => {
		void checkStagnation(sceneManager, bus, eventStore, evolutionRepo);
	}, STAGNATION_CHECK_INTERVAL_MS);

	timer.unref?.();
	return () => clearInterval(timer);
}

async function checkStagnation(
	sceneManager: SceneManager,
	bus: RealtimeBus,
	eventStore?: WorldEventRepository,
	evolutionRepo?: NpcEvolutionRepository,
): Promise<void> {
	const now = Date.now();
	const scenes = await sceneManager.listScenes();

	for (const scene of scenes) {
		const npcs = scene.sceneData.objects.filter((o) => o.type === "npc");

		for (const npc of npcs) {
			const lastInteracted =
				typeof npc.metadata.npcLastInteractedAt === "number" ? npc.metadata.npcLastInteractedAt : null;

			// NPC never interacted with — skip (they haven't been introduced yet)
			if (lastInteracted === null) continue;

			const idleMs = now - lastInteracted;

			// 14+ days: farewell world_event (only once — gate on npcDeparted flag)
			if (idleMs >= STAGNATION_FAREWELL_MS && !npc.metadata.npcDeparted) {
				try {
					if (eventStore) {
						const recentEvents = await eventStore.getRecentEvents(scene.sceneId, 3);
						const eventData = await generateWorldEvent(scene, recentEvents);
						if (eventData) {
							const worldEvent = {
								eventId: makeWorldEventId(),
								sceneId: scene.sceneId,
								createdAt: now,
								...eventData,
								eventType: "npc_departure",
								headline: `${npc.name}已悄然离开这片土地`,
							};
							await eventStore.addEvent(worldEvent);
							for (const sessionId of bus.activeSessions()) {
								bus.publish(sessionId, {
									type: "world_event",
									sceneId: scene.sceneId,
									eventId: worldEvent.eventId,
									worldTime: worldEvent.worldTime,
									eventType: worldEvent.eventType,
									headline: worldEvent.headline,
									body: worldEvent.body,
								});
							}
						}
					}
					await sceneManager.patchObjectMetadata(scene.sceneId, npc.objectId, { npcDeparted: true });
					console.log(`[npc-heartbeat] stagnation farewell: ${npc.name} in ${scene.sceneId}`);
				} catch (err) {
					console.error("[npc-heartbeat] farewell event failed:", npc.name, err);
				}
				continue;
			}

			// 7+ days but < 14 days: repair evolution (only once per stagnation cycle)
			if (idleMs >= STAGNATION_REPAIR_MS && !npc.metadata.npcRepairAppliedAt) {
				try {
					const personality = (npc.metadata.npcPersonality as string | undefined) ?? "一个普通的村民";
					const memory = normalizeMemory(npc.metadata.npcMemory);

					const diff = await generateEvolutionDiff(npc.name, personality, memory, "repair");
					if (diff) {
						const newPersonality = await applyEvolutionDelta(npc.name, personality, diff);
						await sceneManager.patchObjectMetadata(scene.sceneId, npc.objectId, {
							npcPersonality: newPersonality,
							npcRepairAppliedAt: now,
						});
						if (evolutionRepo) {
							const interactionCount =
								typeof npc.metadata.npcInteractionCount === "number" ? npc.metadata.npcInteractionCount : 0;
							const evt = createNpcEvolutionEvent(
								npc.objectId,
								scene.sceneId,
								"stagnation",
								"repair",
								interactionCount,
								personality,
								diff,
							);
							await evolutionRepo.addEvent(evt).catch((err: unknown) => {
								console.error("[npc-heartbeat] evolution repo write failed:", err);
							});
						}
						console.log(`[npc-heartbeat] stagnation repair applied: ${npc.name} in ${scene.sceneId}`);
					}
				} catch (err) {
					console.error("[npc-heartbeat] repair evolution failed:", npc.name, err);
				}
			}
		}
	}
}
