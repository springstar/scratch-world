import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Scene, SceneData } from "../src/scene/types.js";

// ── node:fs/promises mock (hoisted) ──────────────────────────────────────────
vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { createCityTool } from "../src/agent/tools/create-city.js";

// ── Shared helpers ─────────────────────────────────────────────────────────────

function makeScene(overrides: Partial<Scene> = {}): Scene {
	return {
		sceneId: "scene-abc",
		ownerId: "user-1",
		title: "Test Scene",
		description: "test",
		sceneData: { objects: [], environment: {}, viewpoints: [] },
		providerRef: { provider: "claude", assetId: "asset-1" },
		version: 1,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function makeSceneManager(returnScene?: Scene) {
	const scene = returnScene ?? makeScene();
	return {
		createScene: vi.fn().mockResolvedValue(scene),
		updateScene: vi.fn(),
		getScene: vi.fn(),
		listScenes: vi.fn(),
		shareScene: vi.fn(),
	};
}

const ownerId = () => "user-1";
const viewerUrl = (id: string) => `https://viewer.example.com/scenes/${id}`;

// ── create-city tool ──────────────────────────────────────────────────────────

describe("createCityTool", () => {
	let sceneManager: ReturnType<typeof makeSceneManager>;

	beforeEach(() => {
		sceneManager = makeSceneManager();
	});

	it("calls sceneManager.createScene with sceneData that has objects array", async () => {
		const tool = createCityTool(sceneManager as never, ownerId, viewerUrl);
		await tool.execute("run-1", { prompt: "a medieval village", theme: "medieval", size: "village" });

		expect(sceneManager.createScene).toHaveBeenCalledTimes(1);
		const [, , , passedSceneData] = sceneManager.createScene.mock.calls[0] as [
			string,
			string,
			string | undefined,
			SceneData,
		];
		expect(passedSceneData).toBeDefined();
		expect(Array.isArray(passedSceneData.objects)).toBe(true);
		expect(passedSceneData.objects.length).toBeGreaterThan(0);
	});

	it("passes the owner id to createScene", async () => {
		const tool = createCityTool(sceneManager as never, ownerId, viewerUrl);
		await tool.execute("run-1", { prompt: "a town" });
		const [passedOwnerId] = sceneManager.createScene.mock.calls[0] as [string, ...unknown[]];
		expect(passedOwnerId).toBe("user-1");
	});

	it("passes the prompt to createScene", async () => {
		const tool = createCityTool(sceneManager as never, ownerId, viewerUrl);
		await tool.execute("run-1", { prompt: "fantasy city" });
		const [, passedPrompt] = sceneManager.createScene.mock.calls[0] as [string, string, ...unknown[]];
		expect(passedPrompt).toBe("fantasy city");
	});

	it("passes optional title to createScene when provided", async () => {
		const tool = createCityTool(sceneManager as never, ownerId, viewerUrl);
		await tool.execute("run-1", { prompt: "a city", title: "My City" });
		const [, , passedTitle] = sceneManager.createScene.mock.calls[0] as [string, string, string, ...unknown[]];
		expect(passedTitle).toBe("My City");
	});

	it("returns JSON with sceneId, title, viewUrl, buildingCount, segmentCount", async () => {
		const scene = makeScene({ sceneId: "scene-xyz", title: "Test Village" });
		const sm = makeSceneManager(scene);
		const tool = createCityTool(sm as never, ownerId, viewerUrl);
		const result = await tool.execute("run-1", { prompt: "a village" });

		const text = result.content[0];
		expect(text.type).toBe("text");
		const parsed = JSON.parse((text as { type: string; text: string }).text);
		expect(parsed.sceneId).toBe("scene-xyz");
		expect(parsed.title).toBe("Test Village");
		expect(parsed.viewUrl).toContain("scene-xyz");
		expect(typeof parsed.buildingCount).toBe("number");
		expect(typeof parsed.segmentCount).toBe("number");
	});

	it("returns details with sceneId and title", async () => {
		const scene = makeScene({ sceneId: "scene-xyz", title: "Test Village" });
		const sm = makeSceneManager(scene);
		const tool = createCityTool(sm as never, ownerId, viewerUrl);
		const result = await tool.execute("run-1", { prompt: "a village" });
		expect(result.details).toMatchObject({ sceneId: "scene-xyz", title: "Test Village" });
	});

	it("sceneData includes road objects", async () => {
		const tool = createCityTool(sceneManager as never, ownerId, viewerUrl);
		await tool.execute("run-1", { prompt: "a town" });
		const [, , , passedSceneData] = sceneManager.createScene.mock.calls[0] as [
			string,
			string,
			string | undefined,
			SceneData,
		];
		const roadObjs = passedSceneData.objects.filter((o) => o.type === "road");
		expect(roadObjs.length).toBeGreaterThan(0);
	});

	it("sceneData includes a terrain/ground object", async () => {
		const tool = createCityTool(sceneManager as never, ownerId, viewerUrl);
		await tool.execute("run-1", { prompt: "a town" });
		const [, , , passedSceneData] = sceneManager.createScene.mock.calls[0] as [
			string,
			string,
			string | undefined,
			SceneData,
		];
		const ground = passedSceneData.objects.find((o) => o.type === "terrain");
		expect(ground).toBeDefined();
	});

	it("sceneData has environment and viewpoints", async () => {
		const tool = createCityTool(sceneManager as never, ownerId, viewerUrl);
		await tool.execute("run-1", { prompt: "a town" });
		const [, , , passedSceneData] = sceneManager.createScene.mock.calls[0] as [
			string,
			string,
			string | undefined,
			SceneData,
		];
		expect(passedSceneData.environment).toBeDefined();
		expect(Array.isArray(passedSceneData.viewpoints)).toBe(true);
		expect(passedSceneData.viewpoints.length).toBeGreaterThan(0);
	});

	it("passes seed to city generator — same seed produces same road count", async () => {
		// Building placement uses unseeded Math.random(), so only road count is
		// guaranteed deterministic across two separate generate() calls.
		const counts: number[] = [];
		for (let i = 0; i < 2; i++) {
			const sm = makeSceneManager();
			const tool = createCityTool(sm as never, ownerId, viewerUrl);
			await tool.execute("run-seed", { prompt: "a seeded town", seed: 77 });
			const [, , , sd] = sm.createScene.mock.calls[0] as [string, string, string | undefined, SceneData];
			counts.push(sd.objects.filter((o) => o.type === "road").length);
		}
		expect(counts[0]).toBe(counts[1]);
	});

	it("tool name is 'create_city'", () => {
		const tool = createCityTool(sceneManager as never, ownerId, viewerUrl);
		expect(tool.name).toBe("create_city");
	});
});
