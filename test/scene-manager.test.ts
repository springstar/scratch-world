import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SceneManager } from "../src/scene/scene-manager.js";
import { StubProvider } from "../src/providers/stub/provider.js";
import { SceneProviderRegistry } from "../src/providers/scene-provider-registry.js";
import { NarratorRegistry } from "../src/narrators/narrator-registry.js";
import { SqliteSceneRepo } from "../src/storage/sqlite/scene-repo.js";

function makeManager() {
	const db = new Database(":memory:");
	db.pragma("journal_mode = WAL");
	const repo = new SqliteSceneRepo(db);
	const providerRegistryRef = { current: new SceneProviderRegistry([new StubProvider()], "stub") };
	const narratorRegistryRef = { current: new NarratorRegistry([], "none") };
	return new SceneManager(providerRegistryRef, narratorRegistryRef, repo);
}

describe("SceneManager", () => {
	let manager: SceneManager;

	beforeEach(() => {
		manager = makeManager();
	});

	describe("createScene", () => {
		it("returns a scene with version 1", async () => {
			const scene = await manager.createScene("user-1", "a forest");
			expect(scene.version).toBe(1);
			expect(scene.ownerId).toBe("user-1");
		});

		it("uses prompt as title when title is omitted", async () => {
			const scene = await manager.createScene("user-1", "a snowy mountain peak");
			expect(scene.title).toBe("a snowy mountain peak");
		});

		it("truncates title to 60 chars when prompt is long", async () => {
			const longPrompt = "a".repeat(100);
			const scene = await manager.createScene("user-1", longPrompt);
			expect(scene.title.length).toBeLessThanOrEqual(60);
		});

		it("uses provided title when given", async () => {
			const scene = await manager.createScene("user-1", "a big scene", "My Castle");
			expect(scene.title).toBe("My Castle");
		});

		it("persists the scene so it can be retrieved", async () => {
			const created = await manager.createScene("user-1", "a village");
			const found = await manager.getScene(created.sceneId);
			expect(found?.sceneId).toBe(created.sceneId);
		});

		it("writes a v1 snapshot to version history", async () => {
			const db = new Database(":memory:");
			db.pragma("journal_mode = WAL");
			const repo = new SqliteSceneRepo(db);
			const providerRegistryRef = { current: new SceneProviderRegistry([new StubProvider()], "stub") };
			const narratorRegistryRef = { current: new NarratorRegistry([], "none") };
			const m = new SceneManager(providerRegistryRef, narratorRegistryRef, repo);
			const scene = await m.createScene("user-1", "a temple");
			const versions = await repo.findVersions(scene.sceneId);
			expect(versions).toHaveLength(1);
			expect(versions[0].version).toBe(1);
		});

		it("uses provided sceneData directly (skill path)", async () => {
			const sceneData = {
				objects: [
					{
						objectId: "obj_test",
						name: "test object",
						type: "object",
						position: { x: 0, y: 0, z: 0 },
						description: "a test",
						interactable: false,
						metadata: {},
					},
				],
				environment: { skybox: "clear_day" },
				viewpoints: [],
			};
			const scene = await manager.createScene("user-1", "a test scene", undefined, sceneData);
			expect(scene.sceneData.objects[0].objectId).toBe("obj_test");
			expect(scene.providerRef.provider).toBe("claude");
		});
	});

	describe("updateScene", () => {
		it("increments version on each update", async () => {
			const scene = await manager.createScene("user-1", "a castle");
			const v2 = await manager.updateScene(scene.sceneId, "add a moat");
			const v3 = await manager.updateScene(scene.sceneId, "add a drawbridge");
			expect(v2.version).toBe(2);
			expect(v3.version).toBe(3);
		});

		it("adds a new object after edit", async () => {
			const scene = await manager.createScene("user-1", "a castle");
			const updated = await manager.updateScene(scene.sceneId, "add a tower");
			const tower = updated.sceneData.objects.find((o) => o.metadata?.instruction === "add a tower");
			expect(tower).toBeTruthy();
		});

		it("throws for unknown sceneId", async () => {
			await expect(manager.updateScene("nonexistent", "add a moat")).rejects.toThrow("Scene not found");
		});

		it("writes version snapshot for each update", async () => {
			const db = new Database(":memory:");
			db.pragma("journal_mode = WAL");
			const repo = new SqliteSceneRepo(db);
			const providerRegistryRef = { current: new SceneProviderRegistry([new StubProvider()], "stub") };
			const narratorRegistryRef = { current: new NarratorRegistry([], "none") };
			const m = new SceneManager(providerRegistryRef, narratorRegistryRef, repo);
			const scene = await m.createScene("user-1", "a fortress");
			await m.updateScene(scene.sceneId, "add walls");
			await m.updateScene(scene.sceneId, "add towers");
			const versions = await repo.findVersions(scene.sceneId);
			expect(versions).toHaveLength(3); // v1 + v2 + v3
		});

		it("updates using provided sceneData directly (skill path)", async () => {
			const scene = await manager.createScene("user-1", "a castle");
			const newSceneData = {
				objects: [
					{
						objectId: "obj_new",
						name: "new object",
						type: "object",
						position: { x: 0, y: 0, z: 0 },
						description: "newly placed",
						interactable: false,
						metadata: {},
					},
				],
				environment: {},
				viewpoints: [],
			};
			const updated = await manager.updateScene(scene.sceneId, "replace scene", newSceneData);
			expect(updated.sceneData.objects[0].objectId).toBe("obj_new");
		});

		it("throws when updating claude-created scene without sceneData", async () => {
			const sceneData = {
				objects: [],
				environment: {},
				viewpoints: [],
			};
			const scene = await manager.createScene("user-1", "a claude scene", undefined, sceneData);
			await expect(manager.updateScene(scene.sceneId, "add something")).rejects.toThrow("not in registry");
		});
	});

	describe("listScenes", () => {
		it("returns all scenes for an owner", async () => {
			await manager.createScene("user-1", "scene a");
			await manager.createScene("user-1", "scene b");
			await manager.createScene("user-2", "scene c");
			const scenes = await manager.listScenes("user-1");
			expect(scenes).toHaveLength(2);
		});

		it("returns empty array when owner has no scenes", async () => {
			const scenes = await manager.listScenes("nobody");
			expect(scenes).toHaveLength(0);
		});
	});

	describe("navigateTo", () => {
		it("returns correct viewpoint by name", async () => {
			const scene = await manager.createScene("user-1", "a castle");
			const result = await manager.navigateTo(scene.sceneId, "entrance");
			expect(result.viewpoint.name).toBe("entrance");
			expect(result.viewUrl).toContain("vp_entrance");
		});

		it("is case-insensitive", async () => {
			const scene = await manager.createScene("user-1", "a castle");
			const result = await manager.navigateTo(scene.sceneId, "ENTRANCE");
			expect(result.viewpoint.name).toBe("entrance");
		});

		it("throws for unknown viewpoint", async () => {
			const scene = await manager.createScene("user-1", "a castle");
			await expect(manager.navigateTo(scene.sceneId, "throne room")).rejects.toThrow("Viewpoint");
		});

		it("throws for unknown sceneId", async () => {
			await expect(manager.navigateTo("nonexistent", "entrance")).rejects.toThrow("Scene not found");
		});
	});

	describe("interactWithObject", () => {
		it("returns an outcome for an interactable object", async () => {
			const scene = await manager.createScene("user-1", "a castle");
			const main = scene.sceneData.objects.find((o) => o.interactable);
			const result = await manager.interactWithObject(scene.sceneId, main!.objectId, "examine");
			expect(result.outcome).toBeTruthy();
		});

		it("returns sceneChanged: false for a non-mutating action", async () => {
			const scene = await manager.createScene("user-1", "a castle");
			const main = scene.sceneData.objects.find((o) => o.interactable);
			const result = await manager.interactWithObject(scene.sceneId, main!.objectId, "examine");
			expect(result.sceneChanged).toBe(false);
		});

		it("returns cannot interact for non-interactable object", async () => {
			const scene = await manager.createScene("user-1", "a castle");
			const ground = scene.sceneData.objects.find((o) => !o.interactable);
			const result = await manager.interactWithObject(scene.sceneId, ground!.objectId, "touch");
			expect(result.outcome).toContain("cannot be interacted with");
		});

		it("throws for unknown objectId", async () => {
			const scene = await manager.createScene("user-1", "a castle");
			await expect(manager.interactWithObject(scene.sceneId, "nonexistent", "touch")).rejects.toThrow("not found");
		});
	});
});
