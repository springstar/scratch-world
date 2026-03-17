import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { IncomingMessage } from "http";
import { WebSocketServer } from "ws";
import type { SceneManager } from "../scene/scene-manager.js";
import type { SessionManager } from "../session/session-manager.js";
import { RealtimeBus } from "./realtime.js";
import { interactRoute } from "./routes/interact.js";
import { scenesRoute } from "./routes/scenes.js";

export interface ViewerApiOptions {
	port: number;
	sceneManager: SceneManager;
	sessionManager: SessionManager;
}

export interface ViewerApiServer {
	bus: RealtimeBus;
	close(): Promise<void>;
}

export function startViewerApi(opts: ViewerApiOptions): ViewerApiServer {
	const { port, sceneManager, sessionManager } = opts;
	const bus = new RealtimeBus();

	const app = new Hono();

	// CORS — viewer app may be served from a different origin
	app.use("*", async (c, next) => {
		await next();
		c.res.headers.set("Access-Control-Allow-Origin", "*");
		c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		c.res.headers.set("Access-Control-Allow-Headers", "Content-Type");
	});

	app.options("*", (c) => c.body(null, 204));

	app.route("/scenes", scenesRoute(sceneManager));
	app.route("/interact", interactRoute(sessionManager, bus));

	app.get("/health", (c) => c.json({ ok: true }));

	// Start HTTP server
	const server = serve({ fetch: app.fetch, port }, () => {
		console.log(`Viewer API listening on http://localhost:${port}`);
	});

	// Attach WebSocket server to the same HTTP server
	// WS endpoint: ws://host/realtime/:sessionId
	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (req: IncomingMessage, socket, head) => {
		const url = new URL(req.url ?? "/", `http://localhost`);
		const match = url.pathname.match(/^\/realtime\/(.+)$/);
		if (!match) {
			socket.destroy();
			return;
		}
		const sessionId = decodeURIComponent(match[1]);
		wss.handleUpgrade(req, socket, head, (ws) => {
			bus.subscribe(sessionId, ws);
			ws.send(JSON.stringify({ type: "connected", sessionId }));
		});
	});

	return {
		bus,
		close: () =>
			new Promise((resolve, reject) => {
				wss.close((err) => {
					if (err) reject(err);
					else resolve();
				});
			}),
	};
}
