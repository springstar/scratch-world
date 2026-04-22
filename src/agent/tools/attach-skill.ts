import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { randomUUID } from "crypto";
import { behaviorRegistry } from "../../behaviors/registry.js";
import type { SceneManager } from "../../scene/scene-manager.js";
import { registerPicker } from "../../viewer-api/position-picker-registry.js";
import type { RealtimeBus } from "../../viewer-api/realtime.js";

async function requestPositionPick(
	bus: RealtimeBus,
	sessionId: string,
	sceneId: string,
	panoUrl: string,
	objectName: string,
	estimatedPos: { x: number; y: number; z: number },
): Promise<{ x: number; y: number; z: number }> {
	if (!bus.hasSubscribers(sessionId)) return estimatedPos;
	const pickerId = randomUUID();
	const promise = registerPicker(pickerId, estimatedPos);
	bus.publish(sessionId, { type: "position_picker", pickerId, panoUrl, estimatedPos, objectName, sceneId });
	return promise;
}

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the scene containing the object." }),
	objectId: Type.String({ description: "objectId of the scene object to attach the skill to." }),
	skillName: Type.String({
		description:
			"Name of the behavior skill to attach. " +
			"Call this tool with skillName='list' to get a list of available skills and their config schemas.",
	}),
	config: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Skill-specific configuration. Keys and types depend on the chosen skill.",
		}),
	),
});

export function attachSkillTool(
	sceneManager: SceneManager,
	bus?: RealtimeBus,
	sessionId?: string,
): AgentTool<typeof parameters> {
	return {
		name: "attach_skill",
		label: "Attach behavior skill to object",
		description:
			"Wire a behavior skill to an interactable scene object so the viewer runs it when the player presses E. " +
			"Use skillName='list' first to see available skills and their required config fields.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			// Special case: list available skills
			if (params.skillName === "list") {
				const skills = behaviorRegistry.list().map((s) => ({
					name: s.name,
					description: s.description,
					configSchema: s.configSchema,
				}));
				return {
					content: [{ type: "text", text: JSON.stringify({ skills }) }],
					details: {},
				};
			}

			const handler = behaviorRegistry.get(params.skillName);
			if (!handler) {
				const names = behaviorRegistry.list().map((s) => s.name);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: `Unknown skill "${params.skillName}". Available: ${names.join(", ")}`,
							}),
						},
					],
					details: {},
				};
			}

			// Validate required config keys
			const config = params.config ?? {};
			const missing = Object.entries(handler.configSchema)
				.filter(([key, meta]) => meta.required && !(key in config))
				.map(([key]) => key);
			if (missing.length > 0) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: `Missing required config keys for skill "${params.skillName}": ${missing.join(", ")}`,
								configSchema: handler.configSchema,
							}),
						},
					],
					details: {},
				};
			}

			const scene = await sceneManager.getScene(params.sceneId);
			const targetObj = scene?.sceneData.objects.find((o) => o.objectId === params.objectId);

			// Position picker: for VLM-detected objects with a known non-zero position,
			// ask the viewer user to confirm/correct the position before saving.
			if (bus && sessionId && targetObj) {
				const pos = targetObj.position;
				const meta = scene?.sceneData.objects[0]?.metadata as Record<string, unknown> | undefined;
				const panoUrl = (typeof meta?.panoUrl === "string" ? meta.panoUrl : null) ?? "";
				if (panoUrl && (pos.x !== 0 || pos.z !== 0)) {
					const corrected = await requestPositionPick(
						bus,
						sessionId,
						params.sceneId,
						panoUrl,
						targetObj.name,
						pos,
					);
					// If the user corrected the position, update it on the object first
					if (corrected.x !== pos.x || corrected.y !== pos.y || corrected.z !== pos.z) {
						await sceneManager.updateSceneObject(params.sceneId, params.objectId, {
							position: corrected,
						});
					}
				}
			}

			const updated = await sceneManager.updateSceneObject(params.sceneId, params.objectId, {
				interactionHint: `按 E 查看`,
				metadata: {
					skill: { name: params.skillName, config },
				},
			});

			// Pre-generate code for code-gen skills so the mesh is ready when the prop is placed.
			if (params.skillName === "code-gen" && config.prompt) {
				const freshScene = await sceneManager.getScene(params.sceneId);
				const freshObj = freshScene?.sceneData.objects.find((o) => o.objectId === params.objectId);
				try {
					const display = await behaviorRegistry.run({
						objectId: params.objectId,
						objectName: freshObj?.name ?? params.objectId,
						sceneId: params.sceneId,
						objectPosition: freshObj?.position ?? { x: 0, y: 0, z: 0 },
						environment: freshScene?.sceneData.environment,
						displayY:
							typeof freshObj?.metadata?.displayY === "number" ? (freshObj.metadata.displayY as number) : 1.3,
						displayWidth: 1.6,
						displayHeight: 0.9,
						config: { name: params.skillName, config },
					});
					if (display?.type === "script") {
						await sceneManager.updateSceneObject(params.sceneId, params.objectId, {
							metadata: {
								skill: {
									name: params.skillName,
									config: { ...config, cachedCode: display.code, autoRun: true },
								},
							},
						});
						console.log(`[attach-skill] pre-generated code for ${params.skillName} on ${params.objectId}`);
					}
				} catch (err) {
					console.error(`[attach-skill] code pre-generation failed (non-fatal):`, err);
				}
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							ok: true,
							sceneId: updated.sceneId,
							objectId: params.objectId,
							skill: params.skillName,
							version: updated.version,
						}),
					},
				],
				details: { sceneId: updated.sceneId, version: updated.version, sceneChanged: true },
			};
		},
	};
}
