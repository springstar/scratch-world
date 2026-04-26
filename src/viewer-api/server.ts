import { access } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import type { IncomingMessage } from "http";
import { WebSocketServer } from "ws";
import { getRecentLogs } from "../logger.js";
import type { NarratorRegistry } from "../narrators/narrator-registry.js";
import { startNpcHeartbeat } from "../npcs/npc-heartbeat.js";
import type { SceneProviderRegistry } from "../providers/scene-provider-registry.js";
import type { SceneManager } from "../scene/scene-manager.js";
import type { SessionManager } from "../session/session-manager.js";
import type { SkillLoader } from "../skills/skill-loader.js";
import { RealtimeBus } from "./realtime.js";
import { chatRoute } from "./routes/chat.js";
import { colliderProxyRoute } from "./routes/collider-proxy.js";
import { confirmPositionRoute } from "./routes/confirm-position.js";
import { generatorsRoute } from "./routes/generators.js";
import { gltfProxyRoute } from "./routes/gltf-proxy.js";
import { interactRoute } from "./routes/interact.js";
import { mediaUploadRoute } from "./routes/media-upload.js";
import { npcGreetRoute } from "./routes/npc-greet.js";
import { npcInteractRoute } from "./routes/npc-interact.js";
import { scenesRoute } from "./routes/scenes.js";
import { screenshotsRoute } from "./routes/screenshots.js";
import { splatProxyRoute } from "./routes/splat-proxy.js";
import { createUserAssetsTable, userAssetsRoute } from "./routes/user-assets.js";

export interface ViewerApiOptions {
	port: number;
	db: Database.Database;
	sceneManager: SceneManager;
	sessionManager: SessionManager;
	skillLoader: SkillLoader;
	providerRegistryRef: { current: SceneProviderRegistry };
	narratorRegistryRef: { current: NarratorRegistry };
	projectRoot: string;
	marbleApiKey?: string;
	publicUploadsUrl?: string;
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
		db,
		sceneManager,
		sessionManager,
		skillLoader,
		providerRegistryRef,
		narratorRegistryRef,
		projectRoot,
		marbleApiKey,
		publicUploadsUrl = `http://localhost:${opts.port}`,
	} = opts;
	const bus = opts.bus ?? new RealtimeBus();

	// Ensure user_assets table exists
	createUserAssetsTable(db);

	const app = new Hono();

	// CORS — viewer app may be served from a different origin
	app.use("*", async (c, next) => {
		await next();
		c.res.headers.set("Access-Control-Allow-Origin", "*");
		c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
		c.res.headers.set("Access-Control-Allow-Headers", "Content-Type");
	});

	app.options("*", (c) => c.body(null, 204));

	// Static file serving for uploaded panoramas and locally-cached splats.
	// Rigged-model fallback: if a rigged GLB is missing (e.g. Blender not installed),
	// redirect to the original unrigged file in uploads/generated/.
	app.get("/uploads/rigged/:filename", async (c, next) => {
		const filename = c.req.param("filename");
		const riggedPath = join(projectRoot, "uploads", "rigged", filename);
		try {
			await access(riggedPath);
			// File exists — let the static middleware handle it
			return next();
		} catch {
			// File missing — redirect to unrigged equivalent
			const unrigged = filename.replace(/_rigged\.glb$/, ".glb");
			return c.redirect(`/uploads/generated/${unrigged}`, 302);
		}
	});
	app.use("/uploads/*", serveStatic({ root: projectRoot }));

	app.route("/scenes", scenesRoute(sceneManager, projectRoot, bus, sessionManager));
	app.route("/screenshots", screenshotsRoute);
	app.route("/interact", interactRoute(sessionManager, sceneManager, bus));
	app.route("/npc-interact", npcInteractRoute(sceneManager, bus));
	app.route("/npc-greet", npcGreetRoute(sceneManager, bus));
	app.route("/chat", chatRoute(sessionManager, bus));
	app.route("/splat", splatProxyRoute(sceneManager, marbleApiKey));
	app.route("/collider", colliderProxyRoute(sceneManager, marbleApiKey));
	app.route("/gltf-proxy", gltfProxyRoute());
	app.route("/confirm-position", confirmPositionRoute());
	app.route("/user-assets", userAssetsRoute(db, projectRoot));
	app.route("/media-upload", mediaUploadRoute(projectRoot, publicUploadsUrl));
	app.route("/", generatorsRoute(providerRegistryRef, narratorRegistryRef, skillLoader));

	app.get("/health", (c) => c.json({ ok: true }));

	// Debug log viewer — returns the last N structured log entries from the in-memory ring buffer.
	// Usage: GET /debug/logs?limit=100
	app.get("/debug/logs", (c) => {
		const limit = Math.min(Number(c.req.query("limit") ?? 200), 500);
		return c.json({ logs: getRecentLogs(limit) });
	});

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

	// Start NPC world heartbeat — fire spontaneous NPC speech for active sessions
	const stopHeartbeat = startNpcHeartbeat(sceneManager, bus);

	return {
		bus,
		close: () =>
			new Promise((resolve, reject) => {
				stopHeartbeat();
				wss.close((err) => {
					if (err) reject(err);
					else resolve();
				});
			}),
	};
}
