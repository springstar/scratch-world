import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { IncomingMessage } from "http";
import { WebSocketServer } from "ws";
import type { NarratorRegistry } from "../narrators/narrator-registry.js";
import type { SceneProviderRegistry } from "../providers/scene-provider-registry.js";
import type { SceneManager } from "../scene/scene-manager.js";
import type { SessionManager } from "../session/session-manager.js";
import type { SkillLoader } from "../skills/skill-loader.js";
import { RealtimeBus } from "./realtime.js";
import { chatRoute } from "./routes/chat.js";
import { colliderProxyRoute } from "./routes/collider-proxy.js";
import { generatorsRoute } from "./routes/generators.js";
import { interactRoute } from "./routes/interact.js";
import { scenesRoute } from "./routes/scenes.js";
import { screenshotsRoute } from "./routes/screenshots.js";
import { splatProxyRoute } from "./routes/splat-proxy.js";

export interface ViewerApiOptions {
	port: number;
	sceneManager: SceneManager;
	sessionManager: SessionManager;
	skillLoader: SkillLoader;
	providerRegistryRef: { current: SceneProviderRegistry };
	narratorRegistryRef: { current: NarratorRegistry };
	projectRoot: string;
	marbleApiKey?: string;
	/** Pre-created bus shared with GenerationQueue. If omitted, a new bus is created. */
	bus?: RealtimeBus;
}

export interface ViewerApiServer {
	bus: RealtimeBus;
	close(): Promise<void>;
}

export function startViewerApi(opts: ViewerApiOptions): ViewerApiServer {
	const {
		port,
		sceneManager,
		sessionManager,
		skillLoader,
		providerRegistryRef,
		narratorRegistryRef,
		projectRoot,
		marbleApiKey,
	} = opts;
	const bus = opts.bus ?? new RealtimeBus();

	const app = new Hono();

	// CORS — viewer app may be served from a different origin
	app.use("*", async (c, next) => {
		await next();
		c.res.headers.set("Access-Control-Allow-Origin", "*");
		c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
		c.res.headers.set("Access-Control-Allow-Headers", "Content-Type");
	});

	app.options("*", (c) => c.body(null, 204));

	// Static file serving for uploaded panoramas and locally-cached splats
	app.use("/uploads/*", serveStatic({ root: projectRoot }));

	app.route("/scenes", scenesRoute(sceneManager, projectRoot, bus));
	app.route("/screenshots", screenshotsRoute);
	app.route("/interact", interactRoute(sessionManager, bus));
	app.route("/chat", chatRoute(sessionManager, bus));
	app.route("/splat", splatProxyRoute(sceneManager, marbleApiKey));
	app.route("/collider", colliderProxyRoute(sceneManager, marbleApiKey));
	app.route("/", generatorsRoute(providerRegistryRef, narratorRegistryRef, skillLoader));

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
