import { Hono } from "hono";
import { behaviorRegistry } from "../../behaviors/registry.js";
import type { SceneManager } from "../../scene/scene-manager.js";
import type { SessionManager } from "../../session/session-manager.js";
import type { RealtimeBus } from "../realtime.js";

interface InteractBody {
	sessionId: string;
	sceneId: string;
	objectId: string;
	action: string;
	playerPosition?: { x: number; y: number; z: number };
	/** Extra runtime data merged into the skill config — e.g. { userRequest: "..." } for code-gen. */
	interactionData?: Record<string, unknown>;
}

export function interactRoute(
	sessionManager: SessionManager,
	sceneManagerOrBus: SceneManager | RealtimeBus,
	busOrUndefined?: RealtimeBus,
): Hono {
	let sceneManager: SceneManager | undefined;
	let bus: RealtimeBus;
	// Support both (sessionManager, bus) and (sessionManager, sceneManager, bus) signatures
	if (busOrUndefined !== undefined) {
		sceneManager = sceneManagerOrBus as SceneManager;
		bus = busOrUndefined;
	} else {
		sceneManager = undefined;
		bus = sceneManagerOrBus as RealtimeBus;
	}
	const app = new Hono();

	// POST /interact — viewer sends user interaction.
	// If the object has a behavior skill attached (metadata.skill), run it directly and
	// return the DisplayConfig in the response. Otherwise fall through to the agent.
	app.post("/", async (c) => {
		let body: InteractBody;
		try {
			body = await c.req.json<InteractBody>();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const { sessionId, sceneId, objectId, action, playerPosition, interactionData } = body;
		if (!sessionId || !sceneId || !objectId || !action) {
			return c.json({ error: "Missing required fields: sessionId, sceneId, objectId, action" }, 400);
		}

		// ── Behavior skill fast path ──────────────────────────────────────────
		const scene = sceneManager ? await sceneManager.getScene(sceneId) : null;
		if (scene) {
			const obj = scene.sceneData.objects.find((o) => o.objectId === objectId);
			const skillMeta = obj?.metadata.skill;
			if (skillMeta && typeof skillMeta === "object" && skillMeta !== null) {
				try {
					// Merge interactionData into skill config so skills like code-gen can read
					// runtime user input (e.g. userRequest) alongside the stored config.
					const mergedConfig = interactionData
						? {
								...(skillMeta as Record<string, unknown>),
								config: {
									...(((skillMeta as Record<string, unknown>).config ?? {}) as Record<string, unknown>),
									...interactionData,
								},
							}
						: skillMeta;
					// displayY: calibrated mesh height stored in metadata, default 1.3 so mesh is visible on first run
					const displayY = typeof obj?.metadata?.displayY === "number" ? obj.metadata.displayY : 1.3;
					// displayHeight from targetHeight metadata; displayWidth derived from 16:9 if not explicit
					const displayHeight =
						typeof obj?.metadata?.targetHeight === "number" ? obj.metadata.targetHeight : undefined;
					const displayWidth =
						typeof obj?.metadata?.targetWidth === "number"
							? obj.metadata.targetWidth
							: displayHeight
								? Math.round(displayHeight * (16 / 9) * 100) / 100
								: undefined;
					const display = await behaviorRegistry.run({
						objectId,
						objectName: obj?.name ?? objectId,
						sceneId,
						playerPosition,
						objectPosition: obj?.position,
						environment: scene.sceneData.environment,
						displayY,
						displayWidth,
						displayHeight,
						config: mergedConfig as Record<string, unknown>,
					});
					if (display) {
						return c.json({ ok: true, display });
					}
				} catch (err) {
					// Log but fall through to agent path
					console.error(`[behavior-skill] error for ${objectId}:`, err);
				}
			}
		}

		// ── Agent narrative fallback ──────────────────────────────────────────
		const text = `[viewer interaction] ${action} the object "${objectId}" in scene "${sceneId}"`;
		try {
			await sessionManager.dispatchViewerInteraction(sessionId, sceneId, text, bus);
			return c.json({ ok: true });
		} catch (err) {
			const message = err instanceof Error ? err.message : "Internal error";
			bus.publish(sessionId, { type: "error", message });
			return c.json({ error: message }, 500);
		}
	});

	return app;
}
