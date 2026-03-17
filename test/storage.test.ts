import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SqliteSceneRepo } from "../src/storage/sqlite/scene-repo.js";
import { SqliteSessionRepo } from "../src/storage/sqlite/session-repo.js";
import type { Scene } from "../src/scene/types.js";
import type { SessionRecord } from "../src/storage/types.js";

function makeScene(overrides: Partial<Scene> = {}): Scene {
	return {
		sceneId: "scene-1",
		ownerId: "user-1",
		title: "Test Scene",
		description: "A test scene",
		sceneData: {
			objects: [
				{
					objectId: "obj-1",
					name: "rock",
					type: "terrain",
					position: { x: 0, y: 0, z: 0 },
					description: "A rock",
					interactable: false,
					metadata: {},
				},
			],
			environment: { skybox: "clear_day" },
			viewpoints: [
				{
					viewpointId: "vp-1",
					name: "entrance",
					position: { x: 0, y: 1.7, z: -10 },
					lookAt: { x: 0, y: 0, z: 0 },
				},
			],
		},
		providerRef: {
			provider: "stub",
			assetId: "asset-1",
			viewUrl: "https://stub.local/scenes/asset-1",
		},
		version: 1,
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	};
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
	return {
		sessionId: "telegram:user-1",
		userId: "user-1",
		channelId: "telegram",
		activeSceneId: null,
		agentMessages: "[]",
		updatedAt: 1000,
		...overrides,
	};
}

describe("SqliteSceneRepo", () => {
	let repo: SqliteSceneRepo;

	beforeEach(() => {
		const db = new Database(":memory:");
		db.pragma("journal_mode = WAL");
		repo = new SqliteSceneRepo(db);
	});

	it("saves and retrieves a scene by id", async () => {
		const scene = makeScene();
		await repo.save(scene);
		const found = await repo.findById("scene-1");
		expect(found).toMatchObject({ sceneId: "scene-1", title: "Test Scene", version: 1 });
	});

	it("returns null for unknown scene id", async () => {
		const found = await repo.findById("nonexistent");
		expect(found).toBeNull();
	});

	it("lists scenes by owner ordered by updatedAt desc", async () => {
		await repo.save(makeScene({ sceneId: "s1", updatedAt: 1000 }));
		await repo.save(makeScene({ sceneId: "s2", updatedAt: 2000 }));
		const scenes = await repo.findByOwner("user-1");
		expect(scenes).toHaveLength(2);
		expect(scenes[0].sceneId).toBe("s2");
		expect(scenes[1].sceneId).toBe("s1");
	});

	it("upserts on save — updates existing scene", async () => {
		await repo.save(makeScene({ version: 1 }));
		await repo.save(makeScene({ version: 2, title: "Updated Title" }));
		const found = await repo.findById("scene-1");
		expect(found?.version).toBe(2);
		expect(found?.title).toBe("Updated Title");
	});

	it("deletes a scene", async () => {
		await repo.save(makeScene());
		await repo.delete("scene-1");
		expect(await repo.findById("scene-1")).toBeNull();
	});

	it("saves and retrieves version snapshots", async () => {
		const scene = makeScene();
		await repo.saveVersion({
			sceneId: scene.sceneId,
			version: 1,
			sceneData: scene.sceneData,
			providerRef: scene.providerRef,
			createdAt: 1000,
		});
		await repo.saveVersion({
			sceneId: scene.sceneId,
			version: 2,
			sceneData: scene.sceneData,
			providerRef: scene.providerRef,
			createdAt: 2000,
		});
		const versions = await repo.findVersions("scene-1");
		expect(versions).toHaveLength(2);
		expect(versions[0].version).toBe(2); // ordered desc
	});

	it("version snapshots are immutable — INSERT OR IGNORE skips duplicate", async () => {
		const scene = makeScene();
		const snap = {
			sceneId: scene.sceneId,
			version: 1,
			sceneData: scene.sceneData,
			providerRef: scene.providerRef,
			createdAt: 1000,
		};
		await repo.saveVersion(snap);
		await repo.saveVersion({ ...snap, createdAt: 9999 }); // should be ignored
		const v = await repo.findVersion("scene-1", 1);
		expect(v?.createdAt).toBe(1000); // original preserved
	});
});

describe("SqliteSessionRepo", () => {
	let repo: SqliteSessionRepo;

	beforeEach(() => {
		const db = new Database(":memory:");
		repo = new SqliteSessionRepo(db);
	});

	it("saves and retrieves a session by id", async () => {
		await repo.save(makeSession());
		const found = await repo.findById("telegram:user-1");
		expect(found).toMatchObject({ sessionId: "telegram:user-1", userId: "user-1" });
	});

	it("returns null for unknown session", async () => {
		const found = await repo.findById("nonexistent");
		expect(found).toBeNull();
	});

	it("upserts — updates mutable fields only", async () => {
		await repo.save(makeSession({ agentMessages: "[]" }));
		await repo.save(makeSession({ agentMessages: '[{"role":"user"}]', activeSceneId: "scene-1" }));
		const found = await repo.findById("telegram:user-1");
		expect(found?.agentMessages).toBe('[{"role":"user"}]');
		expect(found?.activeSceneId).toBe("scene-1");
	});

	it("deletes a session", async () => {
		await repo.save(makeSession());
		await repo.delete("telegram:user-1");
		expect(await repo.findById("telegram:user-1")).toBeNull();
	});
});
