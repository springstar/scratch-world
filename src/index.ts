import "dotenv/config";
import Database from "better-sqlite3";
import { ChannelGateway } from "./channels/gateway.js";
import { StdinAdapter } from "./channels/stdin/adapter.js";
import { TelegramAdapter } from "./channels/telegram/adapter.js";
import { GenerationQueue } from "./generation/generation-queue.js";
import { narrateWithHaiku } from "./narrators/built-in/haiku.js";
import { NarratorRegistry } from "./narrators/narrator-registry.js";
import { LlmProvider } from "./providers/llm/provider.js";
import { MarbleProvider } from "./providers/marble/provider.js";
import { SceneProviderRegistry } from "./providers/scene-provider-registry.js";
import { StubProvider } from "./providers/stub/provider.js";
import type { SceneRenderProvider } from "./providers/types.js";
import { SceneManager } from "./scene/scene-manager.js";
import { SessionManager } from "./session/session-manager.js";
import { SkillLoader } from "./skills/skill-loader.js";
import { SqliteSceneRepo } from "./storage/sqlite/scene-repo.js";
import { SqliteSessionRepo } from "./storage/sqlite/session-repo.js";
import { RealtimeBus } from "./viewer-api/realtime.js";
import { startViewerApi } from "./viewer-api/server.js";

async function main() {
	// ── Storage ────────────────────────────────────────────────────────────
	const dbUrl = process.env.DATABASE_URL ?? "sqlite:./dev.db";
	const dbPath = dbUrl.replace(/^sqlite:/, "");
	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");

	const sceneRepo = new SqliteSceneRepo(db);
	const sessionRepo = new SqliteSessionRepo(db);

	// ── Project root ───────────────────────────────────────────────────────
	const projectRoot = process.cwd();

	// ── Skills ─────────────────────────────────────────────────────────────
	const skillLoader = new SkillLoader(projectRoot);

	// ── Scene Providers ────────────────────────────────────────────────────
	const apiKey = process.env.ANTHROPIC_API_KEY;
	const marbleKey = process.env.MARBLE_API_KEY;

	const allProviders: SceneRenderProvider[] = [new StubProvider(), new LlmProvider()];
	if (marbleKey) {
		const spzMode = (process.env.SPZ_MODE ?? "proxy") as "proxy" | "local";
		allProviders.push(new MarbleProvider(marbleKey, projectRoot, spzMode));
	}

	const defaultProvider = process.env.SCENE_PROVIDER ?? "stub";
	const providerRegistryRef = {
		current: new SceneProviderRegistry(allProviders, defaultProvider),
	};
	console.log(`Using scene provider: ${defaultProvider}`);

	// ── Narrators ──────────────────────────────────────────────────────────
	const narratorEntries = apiKey
		? [{ manifest: { name: "haiku", description: "Claude Haiku narration" }, fn: narrateWithHaiku }]
		: [];
	const defaultNarrator = apiKey ? "haiku" : "none";
	const narratorRegistryRef = {
		current: new NarratorRegistry(narratorEntries, defaultNarrator),
	};

	// ── Scene + Session managers ───────────────────────────────────────────
	const sceneManager = new SceneManager(providerRegistryRef, sceneRepo);

	// ── Realtime bus + generation queue ────────────────────────────────────
	const bus = new RealtimeBus();
	const generationQueue = new GenerationQueue(bus, sceneManager);

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
	const sessionManager = new SessionManager(
		gateway,
		sceneManager,
		sessionRepo,
		viewerBaseUrl,
		skillLoader,
		generationQueue,
		projectRoot,
	);
	gateway.onMessage(async (msg) => {
		await sessionManager.dispatch(msg);
	});

	startViewerApi({
		port: viewerPort,
		sceneManager,
		sessionManager,
		skillLoader,
		providerRegistryRef,
		narratorRegistryRef,
		projectRoot,
		marbleApiKey: marbleKey,
		bus,
	});

	// ── Start ──────────────────────────────────────────────────────────────
	console.log("Starting scratch-world...");
	await gateway.start();
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
