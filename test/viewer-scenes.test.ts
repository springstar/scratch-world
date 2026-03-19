import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { scenesRoute } from "../src/viewer-api/routes/scenes.js";
import { SceneManager } from "../src/scene/scene-manager.js";
import { StubProvider } from "../src/providers/stub/provider.js";
import { SceneProviderRegistry } from "../src/providers/scene-provider-registry.js";
import { NarratorRegistry } from "../src/narrators/narrator-registry.js";
import { SqliteSceneRepo } from "../src/storage/sqlite/scene-repo.js";

function makeManager() {
	const db = new Database(":memory:");
	db.pragma("journal_mode = WAL");
	const providerRegistryRef = { current: new SceneProviderRegistry([new StubProvider()], "stub") };
	const narratorRegistryRef = { current: new NarratorRegistry([], "none") };
	return new SceneManager(providerRegistryRef, narratorRegistryRef, new SqliteSceneRepo(db));
}

describe("GET /scenes/:sceneId", () => {
	let sceneManager: SceneManager;
	let app: ReturnType<typeof scenesRoute>;

	beforeEach(() => {
		sceneManager = makeManager();
		app = scenesRoute(sceneManager);
	});

	it("returns 404 for unknown sceneId", async () => {
		const res = await app.request("/nonexistent");
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBe("Scene not found");
	});

	it("returns scene data for a known sceneId", async () => {
		const scene = await sceneManager.createScene("user-1", "a forest");
		const res = await app.request(`/${scene.sceneId}`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.sceneId).toBe(scene.sceneId);
		expect(body.title).toBe(scene.title);
		expect(body.version).toBe(1);
		expect(body.sceneData).toBeDefined();
	});

	it("includes providerRef.viewUrl but omits editToken", async () => {
		const scene = await sceneManager.createScene("user-1", "a cave");
		const res = await app.request(`/${scene.sceneId}`);
		const body = await res.json();
		expect(body.providerRef.viewUrl).toBeDefined();
		expect(body.providerRef.editToken).toBeUndefined();
	});

	it("returns updated version after scene edit", async () => {
		const scene = await sceneManager.createScene("user-1", "a desert");
		await sceneManager.updateScene(scene.sceneId, "add an oasis");
		const res = await app.request(`/${scene.sceneId}`);
		const body = await res.json();
		expect(body.version).toBe(2);
	});
});
