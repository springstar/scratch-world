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

			// Guard: auto-convert text-display → tv-display for TV/monitor/screen objects
			if (params.skillName === "text-display") {
				if (targetObj) {
					const nameLower = (targetObj.name ?? "").toLowerCase();
					const tvKeywords = ["tv", "television", "monitor", "screen", "flatscreen", "flat-screen", "flat screen"];
					if (tvKeywords.some((kw) => nameLower.includes(kw))) {
						// Convert: preserve the text content, switch skill to tv-display
						const content = String(config.content ?? "");
						const title = String(config.title ?? targetObj.name);
						// Wrap markdown text in styled HTML for TV rendering
						const htmlLines = content
							.split("\n")
							.filter((l) => l.trim())
							.map((l) => {
								const clean = l
									.replace(/^#+\s*/, "")
									.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
									.trim();
								return `<p style="margin:5px 0">${clean}</p>`;
							})
							.join("");
						const html =
							`<div style="width:100%;height:100%;background:#0a0820;color:#e8d5ff;` +
							`display:flex;flex-direction:column;align-items:center;justify-content:center;` +
							`font-family:system-ui;padding:16px;box-sizing:border-box;overflow:hidden;text-align:center">` +
							`<h3 style="color:#c8a0ff;margin:0 0 10px">${title}</h3>${htmlLines}</div>`;
						const updatedObj = await sceneManager.updateSceneObject(params.sceneId, params.objectId, {
							interactionHint: "按 E 查看",
							metadata: { skill: { name: "tv-display", config: { content: html, title } } },
						});
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify({
										ok: true,
										note: "text-display auto-converted to tv-display for TV/screen object",
										sceneId: updatedObj.sceneId,
										objectId: params.objectId,
										skill: "tv-display",
										version: updatedObj.version,
									}),
								},
							],
							details: { sceneId: updatedObj.sceneId, version: updatedObj.version, sceneChanged: true },
						};
					}
				}
			}

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
