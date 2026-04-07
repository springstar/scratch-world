import type { SceneManager } from "../scene/scene-manager.js";
import type { RealtimeBus } from "../viewer-api/realtime.js";
import { buildPerceptionContext } from "./npc-perception.js";
import { spontaneousNpcLine } from "./npc-runner.js";

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SPONTANEOUS_CHANCE = 0.15; // 15% per NPC per tick

/**
 * Start the NPC world heartbeat.
 * Every TICK_INTERVAL_MS, for each session with an active WebSocket connection,
 * picks the most recently updated scene, randomly selects one NPC, and with
 * SPONTANEOUS_CHANCE probability generates a spontaneous one-liner published
 * via the realtime bus.
 *
 * Returns a stop function that cancels the interval.
 */
export function startNpcHeartbeat(sceneManager: SceneManager, bus: RealtimeBus): () => void {
	const timer = setInterval(() => {
		void tick(sceneManager, bus);
	}, TICK_INTERVAL_MS);

	// Prevent the interval from keeping the process alive
	timer.unref?.();

	return () => clearInterval(timer);
}

async function tick(sceneManager: SceneManager, bus: RealtimeBus): Promise<void> {
	const sessions = bus.activeSessions();
	if (sessions.length === 0) return;

	await Promise.allSettled(sessions.map((sessionId) => tickSession(sceneManager, bus, sessionId)));
}

async function tickSession(sceneManager: SceneManager, bus: RealtimeBus, sessionId: string): Promise<void> {
	// Only bother if the session is still connected
	if (!bus.hasSubscribers(sessionId)) return;

	// Get scenes for this session, most recently updated first
	const scenes = await sceneManager.listScenes(sessionId);
	if (scenes.length === 0) return;

	scenes.sort((a, b) => b.updatedAt - a.updatedAt);
	const scene = scenes[0];

	const npcs = scene.sceneData.objects.filter(
		(o) => o.type === "npc" && (o.interactable || typeof o.metadata?.npcPersonality === "string"),
	);
	if (npcs.length === 0) return;

	// Pick a random NPC, fire with SPONTANEOUS_CHANCE probability per NPC
	const candidate = npcs[Math.floor(Math.random() * npcs.length)];
	if (Math.random() > SPONTANEOUS_CHANCE) return;

	const personality = (candidate.metadata.npcPersonality as string | undefined) ?? "一个普通的村民";
	const memory: string[] = (() => {
		const raw = candidate.metadata.npcMemory;
		if (!Array.isArray(raw)) return [];
		return raw.filter((x): x is string => typeof x === "string");
	})();

	const env = scene.sceneData.environment;
	const perceptionContext = buildPerceptionContext(candidate, scene.sceneData.objects, undefined, env);

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
