import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the scene to update" }),
	instruction: Type.String({ description: "What to change in the scene" }),
});

export function updateSceneTool(sceneManager: SceneManager): AgentTool<typeof parameters> {
	return {
		name: "update_scene",
		label: "Update 3D scene",
		description:
			"Modify an existing scene based on a natural language instruction. Use this when the user wants to add, remove, or change something in a scene.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const scene = await sceneManager.updateScene(params.sceneId, params.instruction);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							sceneId: scene.sceneId,
							title: scene.title,
							version: scene.version,
							viewUrl: scene.providerRef.viewUrl,
							objects: scene.sceneData.objects.map((o) => ({ id: o.objectId, name: o.name, type: o.type })),
						}),
					},
				],
				details: { sceneId: scene.sceneId, version: scene.version, title: scene.title },
			};
		},
	};
}
