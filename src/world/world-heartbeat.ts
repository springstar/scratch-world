import type { SceneManager } from "../scene/scene-manager.js";
import type { WorldEventRepository } from "../storage/types.js";
import type { RealtimeBus } from "../viewer-api/realtime.js";
import { generateWorldEvent, makeWorldEventId } from "./event-generator.js";

const TICK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes real time
const GAME_SECONDS_PER_TICK = 600; // 10 minutes game time → 1 game-day ≈ 24h real
const EVENT_CHANCE = 0.25; // 25% chance of a world event per tick per scene

/**
 * Start the world evolution heartbeat.
 * Every TICK_INTERVAL_MS, for each session with an active WebSocket connection,
 * advances worldTime for all scenes with livingEnabled=true and optionally
 * generates narrative world events via Claude Haiku.
 *
 * Returns a stop function that cancels the interval.
 */
export function startWorldHeartbeat(
	sceneManager: SceneManager,
	bus: RealtimeBus,
	eventStore?: WorldEventRepository,
): () => void {
	const timer = setInterval(() => {
		void tick(sceneManager, bus, eventStore);
	}, TICK_INTERVAL_MS);

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
	if (!bus.hasSubscribers(sessionId)) return;

	const scenes = await sceneManager.listScenes();
	const livingScenes = scenes.filter((s) => s.sceneData.environment?.livingEnabled);
	if (livingScenes.length === 0) return;

	await Promise.allSettled(
		livingScenes.map(async (scene) => {
			const currentTime = scene.sceneData.environment.worldTime ?? 43200; // default: noon
			const newTime = (currentTime + GAME_SECONDS_PER_TICK) % 86400;

			try {
				await sceneManager.updateEnvironment(scene.sceneId, { worldTime: newTime });
				bus.publish(sessionId, {
					type: "world_time_update",
					sceneId: scene.sceneId,
					worldTime: newTime,
				});
			} catch (err) {
				console.error("[world-heartbeat] time update failed:", scene.sceneId, err);
			}

			// World event generation (25% chance, requires eventStore)
			if (eventStore && Math.random() < EVENT_CHANCE) {
				try {
					const recentEvents = await eventStore.getRecentEvents(scene.sceneId, 3);
					const eventData = await generateWorldEvent(scene, recentEvents);
					if (!eventData) return;

					const worldEvent = {
						eventId: makeWorldEventId(),
						sceneId: scene.sceneId,
						createdAt: Date.now(),
						...eventData,
					};
					await eventStore.addEvent(worldEvent);
					bus.publish(sessionId, {
						type: "world_event",
						sceneId: scene.sceneId,
						eventId: worldEvent.eventId,
						worldTime: worldEvent.worldTime,
						eventType: worldEvent.eventType,
						headline: worldEvent.headline,
						body: worldEvent.body,
					});
				} catch (err) {
					console.error("[world-heartbeat] event generation failed:", scene.sceneId, err);
				}
			}
		}),
	);
}
