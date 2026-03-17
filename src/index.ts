import "dotenv/config";
import Database from "better-sqlite3";
import { ChannelGateway } from "./channels/gateway.js";
import { StdinAdapter } from "./channels/stdin/adapter.js";
import { TelegramAdapter } from "./channels/telegram/adapter.js";
import { StubProvider } from "./providers/stub/provider.js";
import { SceneManager } from "./scene/scene-manager.js";
import { SessionManager } from "./session/session-manager.js";
import { SqliteSceneRepo } from "./storage/sqlite/scene-repo.js";
import { SqliteSessionRepo } from "./storage/sqlite/session-repo.js";
import { startViewerApi } from "./viewer-api/server.js";

async function main() {
	// ── Storage ────────────────────────────────────────────────────────────
	const dbUrl = process.env.DATABASE_URL ?? "sqlite:./dev.db";
	const dbPath = dbUrl.replace(/^sqlite:/, "");
	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");

	const sceneRepo = new SqliteSceneRepo(db);
	const sessionRepo = new SqliteSessionRepo(db);

	// ── 3D Provider ────────────────────────────────────────────────────────
	const providerName = process.env.PROVIDER ?? "stub";
	const provider = (() => {
		if (providerName === "stub") return new StubProvider();
		throw new Error(`Unknown provider: ${providerName}. Supported: stub`);
	})();

	console.log(`Using 3D provider: ${provider.name}`);

	// ── Scene + Session managers ───────────────────────────────────────────
	const sceneManager = new SceneManager(provider, sceneRepo);

	// ── Channels ───────────────────────────────────────────────────────────
	const gateway = new ChannelGateway();
	const channel = process.env.CHANNEL ?? "telegram";

	if (channel === "stdin") {
		gateway.register(new StdinAdapter());
	} else {
		const token = process.env.TELEGRAM_BOT_TOKEN;
		if (!token) throw new Error("Missing required environment variable: TELEGRAM_BOT_TOKEN");
		gateway.register(new TelegramAdapter(token));
	}

	// ── Viewer API ─────────────────────────────────────────────────────────
	const viewerPort = Number(process.env.VIEWER_API_PORT ?? "3001");
	const viewerBaseUrl = process.env.VIEWER_BASE_URL ?? `http://localhost:${viewerPort}`;

	// ── Session manager ────────────────────────────────────────────────────
	const sessionManager = new SessionManager(gateway, sceneManager, sessionRepo, viewerBaseUrl);
	gateway.onMessage(async (msg) => {
		await sessionManager.dispatch(msg);
	});

	startViewerApi({ port: viewerPort, sceneManager, sessionManager });

	// ── Start ──────────────────────────────────────────────────────────────
	console.log("Starting scratch-world...");
	await gateway.start();
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
