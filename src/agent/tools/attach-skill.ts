import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { behaviorRegistry } from "../../behaviors/registry.js";
import type { SceneManager } from "../../scene/scene-manager.js";

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

export function attachSkillTool(sceneManager: SceneManager): AgentTool<typeof parameters> {
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
