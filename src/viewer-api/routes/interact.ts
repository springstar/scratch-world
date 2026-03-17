import { Hono } from "hono";
import type { SessionManager } from "../../session/session-manager.js";
import type { RealtimeBus } from "../realtime.js";

interface InteractBody {
	sessionId: string;
	sceneId: string;
	objectId: string;
	action: string;
}

export function interactRoute(sessionManager: SessionManager, bus: RealtimeBus): Hono {
	const app = new Hono();

	// POST /interact — viewer sends user interaction, gets narrative outcome
	app.post("/", async (c) => {
		let body: InteractBody;
		try {
			body = await c.req.json<InteractBody>();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const { sessionId, sceneId, objectId, action } = body;
		if (!sessionId || !sceneId || !objectId || !action) {
			return c.json({ error: "Missing required fields: sessionId, sceneId, objectId, action" }, 400);
		}

		// Synthesize a ChatMessage-like prompt and dispatch through the agent
		// The agent will call interact_with_object and narrate the result.
		// Text deltas are streamed to the viewer via RealtimeBus.
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
