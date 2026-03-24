import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Scene, SceneData } from "../src/scene/types.js";

// ── @gradio/client mock (hoisted) ─────────────────────────────────────────────
// The mock factory uses a module-level variable so individual tests can control
// whether the client succeeds or fails.

let gradioShouldFail = false;
let gradioFakeGlbUrl = "https://hunyuan.example.com/output.glb";

vi.mock("@gradio/client", () => ({
	Client: {
		connect: vi.fn(async () => {
			if (gradioShouldFail) {
				throw new Error("connection refused");
			}
			return {
				predict: vi.fn(async () => ({
					data: [{ url: gradioFakeGlbUrl }],
				})),
			};
		}),
	},
}));

// ── node:fs/promises mock (hoisted) ──────────────────────────────────────────
vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { createCityTool } from "../src/agent/tools/create-city.js";
import { createWorldTool } from "../src/agent/tools/create-world.js";

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
		navigateTo: vi.fn(),
		interactWithObject: vi.fn(),
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

// ── create-world tool ─────────────────────────────────────────────────────────

describe("createWorldTool", () => {
	let sceneManager: ReturnType<typeof makeSceneManager>;

	beforeEach(() => {
		gradioShouldFail = false;
		gradioFakeGlbUrl = "https://hunyuan.example.com/output.glb";
		delete process.env.HF_TOKEN;
		sceneManager = makeSceneManager();
	});

	it("tool name is 'create_world'", () => {
		const tool = createWorldTool(sceneManager as never, ownerId, viewerUrl);
		expect(tool.name).toBe("create_world");
	});

	describe("GLB path (HunyuanWorld succeeds)", () => {
		it("calls createScene with sceneData containing a single GLB object", async () => {
			// Mock global fetch so no real HTTP request is made
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
				ok: true,
				arrayBuffer: () => Promise.resolve(Buffer.from("FAKE_GLB").buffer),
			} as Response);

			const tool = createWorldTool(sceneManager as never, ownerId, viewerUrl);
			await tool.execute("run-glb", { prompt: "a dungeon room" });

			expect(sceneManager.createScene).toHaveBeenCalledTimes(1);
			const [, , , sd] = sceneManager.createScene.mock.calls[0] as [string, string, string | undefined, SceneData];
			expect(sd).toBeDefined();
			expect(sd.objects.length).toBe(1);
			expect(sd.objects[0].metadata.modelUrl).toBeTruthy();

			vi.restoreAllMocks();
		});

		it("GLB object modelUrl starts with /uploads/worlds/", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
				ok: true,
				arrayBuffer: () => Promise.resolve(Buffer.from("GLB").buffer),
			} as Response);

			const tool = createWorldTool(sceneManager as never, ownerId, viewerUrl);
			await tool.execute("run-glb-url", { prompt: "a hall" });

			const [, , , sd] = sceneManager.createScene.mock.calls[0] as [string, string, string | undefined, SceneData];
			expect(sd.objects[0].metadata.modelUrl as string).toMatch(/^\/uploads\/worlds\//);

			vi.restoreAllMocks();
		});

		it("result JSON includes glbUrl", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
				ok: true,
				arrayBuffer: () => Promise.resolve(Buffer.from("GLB").buffer),
			} as Response);

			const scene = makeScene({ sceneId: "glb-scene", title: "Dungeon" });
			const sm = makeSceneManager(scene);
			const tool = createWorldTool(sm as never, ownerId, viewerUrl);

			const result = await tool.execute("run-glb-json", { prompt: "dungeon", title: "Dungeon" });
			const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);

			expect(parsed.sceneId).toBe("glb-scene");
			expect(parsed.glbUrl).toMatch(/^\/uploads\/worlds\//);

			vi.restoreAllMocks();
		});

		it("GLB path sceneData has two viewpoints", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
				ok: true,
				arrayBuffer: () => Promise.resolve(Buffer.from("GLB").buffer),
			} as Response);

			const tool = createWorldTool(sceneManager as never, ownerId, viewerUrl);
			await tool.execute("run-glb-vp", { prompt: "a hall" });

			const [, , , sd] = sceneManager.createScene.mock.calls[0] as [string, string, string | undefined, SceneData];
			expect(sd.viewpoints.length).toBe(2);

			vi.restoreAllMocks();
		});
	});

	describe("fallback path (HunyuanWorld fails)", () => {
		beforeEach(() => {
			gradioShouldFail = true;

			// Make sleep() a no-op so retries don't stall the test suite
			vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: TimerHandler) => {
				if (typeof fn === "function") fn();
				return 0 as unknown as ReturnType<typeof globalThis.setTimeout>;
			});
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("falls back to createScene without sceneData when all attempts fail", async () => {
			const scene = makeScene({ sceneId: "fallback-scene" });
			const sm = makeSceneManager(scene);
			const tool = createWorldTool(sm as never, ownerId, viewerUrl);

			const result = await tool.execute("run-fallback", { prompt: "a garden" });

			expect(sm.createScene).toHaveBeenCalledTimes(1);
			const [, , , sd] = sm.createScene.mock.calls[0] as [string, string, string | undefined, SceneData | undefined];
			expect(sd).toBeUndefined();

			const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
			expect(parsed.fallbackNote).toBeTruthy();
		});

		it("returns sceneId and title from the fallback scene", async () => {
			const scene = makeScene({ sceneId: "fb-scene", title: "A Garden" });
			const sm = makeSceneManager(scene);
			const tool = createWorldTool(sm as never, ownerId, viewerUrl);

			const result = await tool.execute("run-fb2", { prompt: "a garden", title: "A Garden" });
			const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
			expect(parsed.sceneId).toBe("fb-scene");
			expect(parsed.title).toBe("A Garden");
		});

		it("fallback result details includes fallbackNote", async () => {
			const scene = makeScene();
			const sm = makeSceneManager(scene);
			const tool = createWorldTool(sm as never, ownerId, viewerUrl);

			const result = await tool.execute("run-fb3", { prompt: "test" });
			expect(result.details).toHaveProperty("fallbackNote");
		});
	});
});
