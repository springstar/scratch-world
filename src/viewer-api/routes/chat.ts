import { Hono } from "hono";
import type { SessionManager } from "../../session/session-manager.js";
import type { RealtimeBus } from "../realtime.js";

interface ChatBody {
	sessionId: string;
	userId: string;
	text: string;
}

export function chatRoute(sessionManager: SessionManager, bus: RealtimeBus): Hono {
	const app = new Hono();

	// POST /chat — web client sends a free-form message to the agent
	// Streaming response arrives via WebSocket /realtime/:sessionId
	app.post("/", async (c) => {
		let body: ChatBody;
		try {
			body = await c.req.json<ChatBody>();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const { sessionId, userId, text } = body;
		if (!sessionId || !userId || !text?.trim()) {
			return c.json({ error: "Missing required fields: sessionId, userId, text" }, 400);
		}

		// Fire-and-forget — response streams over WebSocket
		sessionManager.dispatchWebChat(sessionId, userId, text, bus).catch((err: unknown) => {
			const message = err instanceof Error ? err.message : "Internal error";
			bus.publish(sessionId, { type: "error", message });
		});

		return c.json({ ok: true });
	});

	return app;
}
