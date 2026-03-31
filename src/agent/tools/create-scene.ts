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
	sceneData: Type.Optional(SceneDataSchema),
	sceneCode: Type.Optional(
		Type.String({
			description:
				"Required JavaScript code executed in the Three.js sandbox to render the scene. Must call stdlib.setupLighting() first, then build all visuals using stdlib helpers or raw THREE. sceneData.objects is only for interaction metadata (NPC dialogue, interactable flags) — not for rendering.",
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
			? "Generate a new 3D scene. Supply only 'prompt' and optional 'title' — do NOT provide sceneData or sceneCode. The provider generates the complete scene."
			: "Generate a new 3D scene. Always supply sceneCode — it is the sole rendering mechanism. Use for all scenes including settlements rendered from create_city layout data.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			console.log(`[create_scene] called, hasSceneData=${!!params.sceneData}, hasSceneCode=${!!params.sceneCode}`);
			// Merge sceneCode into sceneData if provided
			const mergedSceneData = params.sceneCode
				? {
						...(params.sceneData ?? { objects: [], environment: {}, viewpoints: [] }),
						sceneCode: params.sceneCode,
					}
				: params.sceneData;

			if (mergedSceneData) {
				console.log("[create_scene] taking skill path (sceneData or sceneCode provided)");

				// Validate before saving — ERROR violations block scene creation entirely.
				// This forces the agent to call find_gltf_assets and fix the code before proceeding.
				if (params.sceneCode) {
					const preCheck = validateSceneCode(params.sceneCode);
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
				const validationMsg = params.sceneCode ? formatViolations(validateSceneCode(params.sceneCode)) : "";
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
				let operationId: string;
				try {
					({ operationId } = await provider.startGeneration(params.prompt));
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
