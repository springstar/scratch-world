import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@gradio/client";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";
import type { SceneData } from "../../scene/types.js";

const parameters = Type.Object({
	prompt: Type.String({
		description: "Describe the scene (room, dungeon, hall, garden, indoor/outdoor explorable space)",
	}),
	title: Type.Optional(Type.String({ description: "Short title for the scene (max 60 chars)" })),
});

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;
const ATTEMPT_TIMEOUT_MS = 30_000;

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
		),
	]);
}

async function tryGenerateGlb(prompt: string, hfToken?: string): Promise<Buffer> {
	const connectOptions: { hf_token?: `hf_${string}` } = {};
	if (hfToken) {
		connectOptions.hf_token = hfToken as `hf_${string}`;
	}

	let lastError: Error = new Error("Unknown error");

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			console.log(`[create_world] attempt ${attempt}/${MAX_RETRIES} — connecting to HunyuanWorld...`);

			const client = await withTimeout<Client>(
				Client.connect("tencent/HunyuanWorld", connectOptions),
				ATTEMPT_TIMEOUT_MS,
				"connect",
			);

			const result = await withTimeout(
				client.predict("/t2scene", { prompt }) as Promise<{ data: Array<{ url: string; orig_name?: string }> }>,
				ATTEMPT_TIMEOUT_MS,
				"predict",
			);

			const fileObj = result.data[0];
			if (!fileObj?.url) {
				throw new Error("HunyuanWorld returned no file URL in result.data[0]");
			}

			const resp = await fetch(fileObj.url);
			if (!resp.ok) {
				throw new Error(`Failed to download GLB: HTTP ${resp.status}`);
			}

			console.log(`[create_world] attempt ${attempt} succeeded`);
			return Buffer.from(await resp.arrayBuffer());
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			console.warn(`[create_world] attempt ${attempt} failed: ${lastError.message}`);

			if (attempt < MAX_RETRIES) {
				console.log(`[create_world] retrying in ${RETRY_DELAY_MS / 1000}s...`);
				await sleep(RETRY_DELAY_MS);
			}
		}
	}

	throw lastError;
}

export function createWorldTool(
	sceneManager: SceneManager,
	ownerId: () => string,
	viewerUrl: (sceneId: string) => string,
): AgentTool<typeof parameters> {
	return {
		name: "create_world",
		label: "Generate AI 3D world (HunyuanWorld)",
		description:
			"Generate an AI-created explorable 3D scene (room, dungeon, hall, garden, or any single indoor/outdoor space) " +
			"using HunyuanWorld. Produces a photorealistic GLB mesh with PBR textures. " +
			"Use this for indoor spaces or single detailed environments requiring real geometry. " +
			"Use create_city for outdoor settlements. Use create_scene for everything else.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const title = params.title ?? params.prompt.slice(0, 40);
			const hfToken = process.env.HF_TOKEN;

			// Attempt AI generation with retries; fall back to Claude scene on failure
			let glbUrl: string | undefined;
			let fallbackNote: string | undefined;

			try {
				const buf = await tryGenerateGlb(params.prompt, hfToken);

				// Save GLB
				const filename = `${randomUUID()}.glb`;
				const worldsDir = join(process.cwd(), "uploads", "worlds");
				await mkdir(worldsDir, { recursive: true });
				await writeFile(join(worldsDir, filename), buf);
				glbUrl = `/uploads/worlds/${filename}`;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(
					`[create_world] all ${MAX_RETRIES} attempts failed, falling back to Claude scene. Last error: ${msg}`,
				);
				fallbackNote = `HunyuanWorld 暂时不可用（已重试 ${MAX_RETRIES} 次），已降级为 Claude 生成场景。如需 AI 3D 模型，请稍后重试。`;
			}

			let sceneData: SceneData;

			if (glbUrl) {
				// GLB path: single object entry loaded via GLTF
				sceneData = {
					objects: [
						{
							objectId: "world_0",
							name: title,
							type: "object",
							position: { x: 0, y: 0, z: 0 },
							description: params.prompt,
							interactable: false,
							metadata: { modelUrl: glbUrl },
						},
					],
					environment: { skybox: "overcast", ambientLight: "cool" },
					viewpoints: [
						{
							viewpointId: "vp_entry",
							name: "Entry",
							position: { x: 0, y: 1.7, z: 6 },
							lookAt: { x: 0, y: 1, z: 0 },
						},
						{
							viewpointId: "vp_top",
							name: "Overview",
							position: { x: 0, y: 8, z: 8 },
							lookAt: { x: 0, y: 0, z: 0 },
						},
					],
				};
			} else {
				// Fallback: delegate to SceneManager (Claude LLM provider path)
				const scene = await sceneManager.createScene(ownerId(), params.prompt, title, undefined);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								sceneId: scene.sceneId,
								title: scene.title,
								viewUrl: viewerUrl(scene.sceneId),
								fallbackNote,
							}),
						},
					],
					details: { sceneId: scene.sceneId, title: scene.title, fallbackNote },
				};
			}

			const scene = await sceneManager.createScene(ownerId(), params.prompt, title, sceneData);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							sceneId: scene.sceneId,
							title: scene.title,
							viewUrl: viewerUrl(scene.sceneId),
							glbUrl,
						}),
					},
				],
				details: { sceneId: scene.sceneId, title: scene.title, glbUrl },
			};
		},
	};
}
