import type { SceneManager } from "../scene/scene-manager.js";
import type { WorldEventRepository } from "../storage/types.js";
import type { RealtimeBus } from "../viewer-api/realtime.js";
import { generateWorldEvent, makeWorldEventId } from "./event-generator.js";
import { detectWeatherOverlay } from "./weather-overlay.js";

const TICK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes real time
const GAME_SECONDS_PER_TICK = 600; // 10 minutes game time → 1 game-day ≈ 24h real
const EVENT_CHANCE = 0.25; // 25% chance of a world event per tick per scene
// Catchup cap: at most 2 game-days of elapsed time recovered on restart
const MAX_CATCHUP_GAME_SECONDS = 2 * 86400;
// Scenes with no visitors for 24h+ tick at 1/6 rate (every 60 min instead of 10 min)
const INACTIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const SLOW_TICK_MS = 60 * 60 * 1000;

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

/**
 * On server restart, advance worldTime for all livingEnabled scenes by the
 * real time that elapsed since the last heartbeat (capped at 2 game-days).
 * No event generation — just time catchup, no API calls.
 */
export async function catchUpWorldTime(sceneManager: SceneManager): Promise<void> {
	const now = Date.now();
	const scenes = await sceneManager.listScenes();
	await Promise.allSettled(
		scenes
			.filter((s) => s.sceneData.environment?.livingEnabled && s.sceneData.environment.lastHeartbeatAt)
			.map(async (scene) => {
				const env = scene.sceneData.environment;
				const missedMs = now - env.lastHeartbeatAt!;
				if (missedMs < TICK_INTERVAL_MS) return; // less than one tick — not worth updating
				const missedGameSeconds = Math.min(missedMs / 1000, MAX_CATCHUP_GAME_SECONDS);
				const currentTime = env.worldTime ?? 43200;
				const newTime = (currentTime + missedGameSeconds) % 86400;
				await sceneManager.updateEnvironment(scene.sceneId, {
					worldTime: newTime,
					lastHeartbeatAt: now,
				});
				console.log(
					`[world-heartbeat] catchup ${scene.sceneId}: +${Math.round(missedGameSeconds / 3600)}h game-time`,
				);
			}),
	);
}

/**
 * Force a single tick for one scene, broadcasting to all active sessions.
 * Used by the admin debug endpoint — does not require an active session.
 */
export async function tickSceneOnce(
	sceneId: string,
	sceneManager: SceneManager,
	bus: RealtimeBus,
	eventStore?: WorldEventRepository,
): Promise<{ worldTime: number; eventGenerated: boolean }> {
	const scene = await sceneManager.getScene(sceneId);
	if (!scene) throw new Error(`Scene not found: ${sceneId}`);

	const currentTime = scene.sceneData.environment?.worldTime ?? 43200;
	const newTime = (currentTime + GAME_SECONDS_PER_TICK) % 86400;

	await sceneManager.updateEnvironment(sceneId, { worldTime: newTime, lastHeartbeatAt: Date.now() });

	for (const sessionId of bus.activeSessions()) {
		bus.publish(sessionId, { type: "world_time_update", sceneId, worldTime: newTime });
	}

	let eventGenerated = false;
	if (eventStore) {
		const recentEvents = await eventStore.getRecentEvents(sceneId, 3);
		const eventData = await generateWorldEvent(scene, recentEvents);
		if (eventData) {
			const worldEvent = {
				eventId: makeWorldEventId(),
				sceneId,
				createdAt: Date.now(),
				worldTime: eventData.worldTime,
				eventType: eventData.eventType,
				headline: eventData.headline,
				body: eventData.body,
			};
			await eventStore.addEvent(worldEvent);

			if (eventData.updatedNarrative) {
				await sceneManager.updateEnvironment(sceneId, {
					worldNarrative: eventData.updatedNarrative,
				});
			}

			for (const sessionId of bus.activeSessions()) {
				bus.publish(sessionId, {
					type: "world_event",
					sceneId,
					eventId: worldEvent.eventId,
					worldTime: worldEvent.worldTime,
					eventType: worldEvent.eventType,
					headline: worldEvent.headline,
					body: worldEvent.body,
					...(eventData.updatedNarrative ? { worldNarrative: eventData.updatedNarrative } : {}),
				});
			}

			if (worldEvent.eventType === "weather") {
				const overlay = detectWeatherOverlay(worldEvent.headline);
				if (overlay) {
					for (const sessionId of bus.activeSessions()) {
						bus.publish(sessionId, {
							type: "weather_overlay",
							sceneId,
							overlayType: overlay.type,
							...(overlay.code ? { code: overlay.code } : {}),
						});
					}
				}
			}

			eventGenerated = true;
		}
	}

	return { worldTime: newTime, eventGenerated };
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
			const now = Date.now();
			// Slow-tick inactive scenes: if no visitor in 24h, only tick every 60 min
			const lastVisited = scene.sceneData.environment.lastVisitedAt ?? 0;
			if (now - lastVisited > INACTIVE_THRESHOLD_MS) {
				const lastTick = scene.sceneData.environment.lastHeartbeatAt ?? 0;
				if (now - lastTick < SLOW_TICK_MS) return;
			}

			const currentTime = scene.sceneData.environment.worldTime ?? 43200; // default: noon
			const newTime = (currentTime + GAME_SECONDS_PER_TICK) % 86400;

			try {
				await sceneManager.updateEnvironment(scene.sceneId, {
					worldTime: newTime,
					lastHeartbeatAt: Date.now(),
				});
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
						worldTime: eventData.worldTime,
						eventType: eventData.eventType,
						headline: eventData.headline,
						body: eventData.body,
					};
					await eventStore.addEvent(worldEvent);

					if (eventData.updatedNarrative) {
						await sceneManager.updateEnvironment(scene.sceneId, {
							worldNarrative: eventData.updatedNarrative,
						});
					}

					bus.publish(sessionId, {
						type: "world_event",
						sceneId: scene.sceneId,
						eventId: worldEvent.eventId,
						worldTime: worldEvent.worldTime,
						eventType: worldEvent.eventType,
						headline: worldEvent.headline,
						body: worldEvent.body,
						...(eventData.updatedNarrative ? { worldNarrative: eventData.updatedNarrative } : {}),
					});

					if (worldEvent.eventType === "weather") {
						const overlay = detectWeatherOverlay(worldEvent.headline);
						if (overlay) {
							bus.publish(sessionId, {
								type: "weather_overlay",
								sceneId: scene.sceneId,
								overlayType: overlay.type,
								...(overlay.code ? { code: overlay.code } : {}),
							});
						}
					}
				} catch (err) {
					console.error("[world-heartbeat] event generation failed:", scene.sceneId, err);
				}
			}
		}),
	);
}
