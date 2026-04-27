import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { GenerationQueue } from "../../generation/generation-queue.js";
import { DEFAULT_TIMEOUT_MS } from "../../generation/generation-queue.js";
import type { SceneManager } from "../../scene/scene-manager.js";
import { SceneDataSchema } from "../../scene/schema.js";
import { formatViolations, validateSceneCode } from "../scene-validator.js";

const parameters = Type.Object({
	prompt: Type.String({ description: "Detailed description of the scene to generate" }),
	title: Type.Optional(Type.String({ description: "Short title for the scene (max 60 chars)" })),
	imagePath: Type.Optional(
		Type.String({
			description:
				"Local file path of a single uploaded image for Marble generation. " +
				"Use the path from [上传图片: path=...]. Use imagePaths instead when multiple images are uploaded. " +
				"360° equirectangular panoramas (2:1 aspect ratio) produce especially coherent and navigable worlds.",
		}),
	),
	imagePaths: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Local file paths of multiple uploaded images for Marble multi-image generation. " +
				"Collect ALL [上传图片: path=...] values from context and pass them here. " +
				"Azimuths are assigned automatically (0°, 360°/n, 720°/n, …). " +
				"Use this whenever 2 or more images are present in context. " +
				"Works with photos, concept art, illustrations, or sketches.",
		}),
	),
	imageUrl: Type.Optional(
		Type.String({
			description: "Fallback public URL of a single uploaded photo. Use only when imagePath is unavailable.",
		}),
	),
	videoPath: Type.Optional(
		Type.String({
			description:
				"Local file path of an uploaded video for Marble generation. " +
				"Use the path from [上传视频: path=...] in context.",
		}),
	),
	sceneData: Type.Optional(SceneDataSchema),
	sceneCode: Type.Optional(
		Type.String({
			description:
				"Required JavaScript code executed in the Three.js sandbox to render the scene. Must call stdlib.setupLighting() first, then build all visuals using stdlib helpers or raw THREE. sceneData.objects is only for interaction metadata (NPC dialogue, interactable flags) — not for rendering.",
		}),
	),
	assetPrescanDone: Type.Optional(
		Type.Boolean({
			description:
				"Set to true after completing the asset pre-scan (Step 6): you called find_gltf_assets for the top 3 object categories. " +
				"Required when sceneCode builds objects from primitive geometry. " +
				"If find_gltf_assets returned no results for a category, set this to true and use stdlib fallbacks (makeNpc, makeTree, makeBuilding).",
		}),
	),
});

export function createSceneTool(
	sceneManager: SceneManager,
	ownerId: () => string,
	viewerUrl: (sceneId: string) => string,
	generationQueue: GenerationQueue,
	sessionId: string,
): AgentTool<typeof parameters> {
	const providerHandlesGeneration = !!sceneManager.getActiveProvider().providesOwnRendering;
	return {
		name: "create_scene",
		label: "Create 3D scene",
		description: providerHandlesGeneration
			? "Generate a new 3D scene from a text prompt or uploaded media. Supply 'prompt' and optional 'title'. For uploaded images/videos, pass the file path(s) from context: imagePaths (array) for 2+ images, imagePath for a single image, videoPath for a video. Do NOT provide sceneData or sceneCode."
			: "Generate a new 3D scene. Always supply sceneCode — it is the sole rendering mechanism. Use for all scenes including settlements rendered from create_city layout data.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			console.log(
				`[create_scene] called params=${JSON.stringify({ prompt: params.prompt?.slice(0, 80), imagePath: params.imagePath, imagePaths: params.imagePaths, videoPath: params.videoPath, imageUrl: params.imageUrl, hasSceneData: !!params.sceneData, hasSceneCode: !!params.sceneCode })}`,
			);
			// When provider handles its own rendering (e.g. Marble), sceneData is metadata only
			// (spawn points, interaction objects). Do NOT take the skill path for metadata-only sceneData —
			// only take it when sceneCode is present (custom Three.js rendering).
			const mergedSceneData = params.sceneCode
				? {
						...(params.sceneData ?? { objects: [], environment: {}, viewpoints: [] }),
						sceneCode: params.sceneCode,
					}
				: params.sceneData;

			if (mergedSceneData && (!providerHandlesGeneration || params.sceneCode)) {
				console.log("[create_scene] taking skill path (sceneData or sceneCode provided)");

				// Validate before saving — ERROR violations block scene creation entirely.
				// Exception: assetPrescanDone=true means agent confirmed it called find_gltf_assets
				// and got no results — procedural fallback is then legitimate.
				if (params.sceneCode) {
					const prescanBypassed = params.assetPrescanDone === true;
					const preCheck = validateSceneCode(params.sceneCode, { skipAssetPrescan: prescanBypassed });
					const errors = preCheck.violations.filter((v) => v.severity === "error");
					if (errors.length > 0) {
						const msg = formatViolations(preCheck);
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify({
										error: "Scene not created — validation errors must be fixed first.",
										violations: msg,
									}),
								},
							],
							details: { error: "validation_failed" },
						};
					}
				}

				const scene = await sceneManager.createScene(ownerId(), params.prompt, params.title, mergedSceneData);
				const validationMsg = params.sceneCode
					? formatViolations(validateSceneCode(params.sceneCode, { skipAssetPrescan: true }))
					: "";
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								sceneId: scene.sceneId,
								title: scene.title,
								status: "ready",
								viewUrl: viewerUrl(scene.sceneId),
								objects: scene.sceneData.objects.map((o) => ({ id: o.objectId, name: o.name, type: o.type })),
								viewpoints: scene.sceneData.viewpoints.map((v) => v.name),
								...(validationMsg ? { violations: validationMsg } : {}),
							}),
						},
					],
					details: { sceneId: scene.sceneId, title: scene.title },
				};
			}

			// Provider path — use async if provider supports it
			const provider = sceneManager.getActiveProvider();
			console.log(`[create_scene] taking provider path, provider=${provider.name}`);
			if (provider.startGeneration) {
				const title = params.title ?? params.prompt.slice(0, 60);
				// Priority: multi-image paths > single path > URL
				const genOptions =
					params.imagePaths && params.imagePaths.length > 0
						? { multiImageFilePaths: params.imagePaths }
						: params.imagePath
							? { imageFilePath: params.imagePath }
							: params.imageUrl
								? { imageUrl: params.imageUrl }
								: params.videoPath
									? { videoFilePath: params.videoPath }
									: undefined;
				let operationId: string;
				try {
					({ operationId } = await provider.startGeneration(params.prompt, genOptions));
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					console.error(`[create_scene] provider.startGeneration failed: ${msg}`);
					return {
						content: [{ type: "text", text: JSON.stringify({ error: msg }) }],
						details: { error: msg },
					};
				}
				const scene = await sceneManager.createSceneAsync(
					ownerId(),
					params.prompt,
					title,
					operationId,
					provider.name,
					params.sceneData,
				);
				const url = viewerUrl(scene.sceneId);
				generationQueue.enqueue({
					type: "create",
					sceneId: scene.sceneId,
					sessionId,
					viewerUrl: url,
					title: scene.title,
					provider,
					operationId,
					timeoutMs: DEFAULT_TIMEOUT_MS,
				});
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								sceneId: scene.sceneId,
								title: scene.title,
								status: "generating",
								message:
									"Generation started. The scene will appear in chat when ready (~15 s for LLM, ~5 min for Marble).",
							}),
						},
					],
					details: { sceneId: scene.sceneId, title: scene.title, generating: true },
				};
			}

			// Synchronous fallback (e.g. StubProvider)
			const scene = await sceneManager.createScene(ownerId(), params.prompt, params.title);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							sceneId: scene.sceneId,
							title: scene.title,
							status: "ready",
							viewUrl: viewerUrl(scene.sceneId),
							objects: scene.sceneData.objects.map((o) => ({ id: o.objectId, name: o.name, type: o.type })),
							viewpoints: scene.sceneData.viewpoints.map((v) => v.name),
						}),
					},
				],
				details: { sceneId: scene.sceneId, title: scene.title },
			};
		},
	};
}
