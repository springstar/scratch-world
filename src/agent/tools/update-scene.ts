import { createHash } from "node:crypto";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { GenerationQueue } from "../../generation/generation-queue.js";
import { DEFAULT_TIMEOUT_MS } from "../../generation/generation-queue.js";
import type { SceneManager } from "../../scene/scene-manager.js";
import { SceneDataSchema } from "../../scene/schema.js";
import { generateSceneCollider } from "../../world/collider-builder.js";
import { formatViolations, validateSceneCode } from "../scene-validator.js";

// Tracks recent update hashes per session to detect repair loops.
// Cleared when the session ends (module lives for server lifetime, keys are session IDs).
const repairLoopTracker = new Map<string, { sceneId: string; hashes: string[] }>();

function sceneDataHash(data: unknown): string {
	return createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);
}

function checkRepairLoop(sessionId: string, sceneId: string, data: unknown): boolean {
	const hash = sceneDataHash(data);
	const entry = repairLoopTracker.get(sessionId);

	if (!entry || entry.sceneId !== sceneId) {
		repairLoopTracker.set(sessionId, { sceneId, hashes: [hash] });
		return false;
	}

	const hashes = [...entry.hashes, hash].slice(-3);
	repairLoopTracker.set(sessionId, { sceneId, hashes });
	return hashes.length === 3 && hashes.every((h) => h === hashes[0]);
}

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the scene to update" }),
	instruction: Type.String({ description: "What to change in the scene" }),
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

export function updateSceneTool(
	sceneManager: SceneManager,
	viewerUrl: (sceneId: string) => string,
	generationQueue: GenerationQueue,
	sessionId: string,
	uploadsDir?: string,
	publicBaseUrl?: string,
): AgentTool<typeof parameters> {
	const providerHandlesGeneration = !!sceneManager.getActiveProvider().providesOwnRendering;
	return {
		name: "update_scene",
		label: "Update 3D scene",
		description: providerHandlesGeneration
			? "Modify an existing scene. Supply only 'sceneId' and 'instruction' — do NOT provide sceneData or sceneCode. The provider regenerates the scene from the instruction. NEVER use this to place props or objects in a Marble/splat scene — call place_prop instead."
			: "Modify an existing scene based on a natural language instruction. Always supply sceneCode — it is the sole rendering mechanism. Use this when the user wants to add, remove, or change something in a scene. NEVER use this to place props or objects in a Marble/splat scene — call place_prop instead.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			console.log(`[update_scene] called, hasSceneData=${!!params.sceneData}, hasSceneCode=${!!params.sceneCode}`);
			const mergedSceneData = params.sceneCode
				? {
						...(params.sceneData ?? { objects: [], environment: {}, viewpoints: [] }),
						sceneCode: params.sceneCode,
					}
				: params.sceneData;

			// Skill path (sceneData supplied directly) — always synchronous
			if (mergedSceneData) {
				// Validate before saving — ERROR violations block the update entirely.
				// Exception: assetPrescanDone=true means agent confirmed prescan was done.
				let effectiveSceneData = mergedSceneData;
				if (params.sceneCode) {
					const prescanBypassed = params.assetPrescanDone === true;
					const preCheck = validateSceneCode(params.sceneCode, { skipAssetPrescan: prescanBypassed });
					const errors = preCheck.violations.filter((v) => v.severity === "error");
					if (errors.length > 0) {
						const syntaxOrBanned = errors.some((v) => v.rule === "syntax-error" || v.rule === "banned-api");
						const hasFallbackData = (params.sceneData?.objects?.length ?? 0) > 0;
						if (syntaxOrBanned && hasFallbackData) {
							// Syntax/security errors with structured data available — strip sceneCode and
							// fall back to JSON rendering so the scene is still usable.
							const { sceneCode: _dropped, ...jsonOnly } = mergedSceneData;
							effectiveSceneData = jsonOnly;
							const msg = formatViolations(preCheck);
							console.warn(
								`[update_scene] sceneCode has unrecoverable errors — falling back to JSON render. ${msg}`,
							);
						} else {
							const msg = formatViolations(preCheck);
							return {
								content: [
									{
										type: "text",
										text: JSON.stringify({
											error: "Scene not updated — validation errors must be fixed first.",
											violations: msg,
										}),
									},
								],
								details: { error: "validation_failed" },
							};
						}
					}
				}

				const scene = await sceneManager.updateScene(params.sceneId, params.instruction, effectiveSceneData);

				// Regenerate collider after each sceneCode update (objects may have changed)
				if (!scene.sceneData.splatUrl && uploadsDir && publicBaseUrl) {
					generateSceneCollider(scene.sceneId, scene.sceneData.objects, uploadsDir, publicBaseUrl)
						.then((url) => sceneManager.patchColliderUrl(scene.sceneId, url))
						.catch((err: unknown) => console.warn(`[update_scene] collider generation failed: ${String(err)}`));
				}
				const validationMsg = params.sceneCode
					? formatViolations(validateSceneCode(params.sceneCode, { skipAssetPrescan: true }))
					: "";
				const looping = checkRepairLoop(sessionId, params.sceneId, effectiveSceneData);
				const loopWarning = looping
					? "⚠ REPAIR LOOP DETECTED: You have submitted 3 consecutive update_scene calls for this scene with no meaningful change. The user's request is not being satisfied by incremental edits. You MUST stop calling update_scene and instead call create_scene to regenerate the scene from scratch with a complete, corrected sceneCode."
					: undefined;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								sceneId: scene.sceneId,
								title: scene.title,
								version: scene.version,
								status: "ready",
								viewUrl: viewerUrl(scene.sceneId),
								objects: scene.sceneData.objects.map((o) => ({ id: o.objectId, name: o.name, type: o.type })),
								...(validationMsg ? { violations: validationMsg } : {}),
								...(loopWarning ? { repairLoop: loopWarning } : {}),
							}),
						},
					],
					details: { sceneId: scene.sceneId, version: scene.version, title: scene.title, sceneChanged: true },
				};
			}

			// Provider path — use async if provider supports it
			const provider = sceneManager.getActiveProvider();
			if (provider.startGeneration) {
				const { operationId } = await provider.startGeneration(params.instruction);
				const scene = await sceneManager.updateSceneAsync(params.sceneId, operationId);
				const url = viewerUrl(scene.sceneId);
				generationQueue.enqueue({
					type: "update",
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
									"Update started. The scene will be refreshed in chat when ready (~15 s for LLM, ~5 min for Marble).",
							}),
						},
					],
					details: { sceneId: scene.sceneId, title: scene.title, generating: true },
				};
			}

			// Synchronous fallback (e.g. StubProvider)
			const scene = await sceneManager.updateScene(params.sceneId, params.instruction);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							sceneId: scene.sceneId,
							title: scene.title,
							version: scene.version,
							status: "ready",
							viewUrl: viewerUrl(scene.sceneId),
							objects: scene.sceneData.objects.map((o) => ({ id: o.objectId, name: o.name, type: o.type })),
						}),
					},
				],
				details: { sceneId: scene.sceneId, version: scene.version, title: scene.title, sceneChanged: true },
			};
		},
	};
}
