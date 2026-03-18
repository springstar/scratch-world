import "dotenv/config";
import Database from "better-sqlite3";
import { completeSimple, getModel } from "@mariozechner/pi-ai";
import { ChannelGateway } from "./channels/gateway.js";
import { StdinAdapter } from "./channels/stdin/adapter.js";
import { TelegramAdapter } from "./channels/telegram/adapter.js";
import { LlmProvider } from "./providers/llm/provider.js";
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
	const apiKey = process.env.ANTHROPIC_API_KEY;
	const provider = apiKey ? new LlmProvider() : new StubProvider();
	console.log(`Using 3D provider: ${provider.name}`);

	// ── Narrate function (LLM-powered interaction narratives) ──────────────
	let narrateFn: ((prompt: string) => Promise<string>) | null = null;
	if (apiKey) {
		narrateFn = async (prompt: string): Promise<string> => {
			const model = getModel("anthropic", "claude-haiku-4-5-20251001");
			if (process.env.ANTHROPIC_BASE_URL) model.baseUrl = process.env.ANTHROPIC_BASE_URL;
			const response = await completeSimple(model, {
				messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			});
			const text = response.content
				.filter((c) => c.type === "text")
				.map((c) => (c as { type: "text"; text: string }).text)
				.join("");
			return text.trim() || "Nothing remarkable happens.";
		};
	}

	// ── Scene + Session managers ───────────────────────────────────────────
	const sceneManager = new SceneManager(provider, sceneRepo, narrateFn);

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
