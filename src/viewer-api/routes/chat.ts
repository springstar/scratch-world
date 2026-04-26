import { Hono } from "hono";
import type { SessionManager } from "../../session/session-manager.js";
import type { RealtimeBus } from "../realtime.js";

interface ChatBody {
	sessionId: string;
	userId: string;
	text: string;
	sceneId?: string;
	images?: Array<{ base64: string; mimeType: string }>;
	/** Pre-uploaded media files (images or videos uploaded via /media-upload) */
	mediaFiles?: Array<{ filePath: string; publicUrl: string; mimeType: string; kind: "image" | "video" }>;
	playerPosition?: { x: number; y: number; z: number };
	clickPosition?: { x: number; y: number; z: number };
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

		const { sessionId, userId, text, sceneId, images, mediaFiles, playerPosition, clickPosition } = body;
		if (!sessionId || !userId || (!text?.trim() && !images?.length && !mediaFiles?.length)) {
			return c.json({ error: "Missing required fields: sessionId, userId, and text or images/mediaFiles" }, 400);
		}

		// Fire-and-forget — response streams over WebSocket
		sessionManager
			.dispatchWebChat(
				sessionId,
				userId,
				text ?? "",
				bus,
				images,
				playerPosition,
				clickPosition,
				sceneId,
				mediaFiles,
			)
			.catch((err: unknown) => {
				// err.message is empty for AggregateError (e.g. ECONNREFUSED); fall back to toString()
				const message = err instanceof Error ? err.message || String(err) : String(err);
				console.error(`[chat] dispatchWebChat error for session ${sessionId}:`, err);
				bus.publish(sessionId, { type: "error", message });
			});

		return c.json({ ok: true });
	});

	return app;
}
