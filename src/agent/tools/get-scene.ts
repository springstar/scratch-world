import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the scene to retrieve" }),
});

export function getSceneTool(sceneManager: SceneManager): AgentTool<typeof parameters> {
	return {
		name: "get_scene",
		label: "Get scene details",
		description: "Retrieve the current state of a scene by its ID.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const scene = await sceneManager.getScene(params.sceneId);
			if (!scene) throw new Error(`Scene not found: ${params.sceneId}`);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							sceneId: scene.sceneId,
							title: scene.title,
							description: scene.description,
							version: scene.version,
							viewUrl: scene.providerRef.viewUrl,
							objects: scene.sceneData.objects.map((o) => ({
								id: o.objectId,
								name: o.name,
								type: o.type,
								description: o.description,
								interactable: o.interactable,
								interactionHint: o.interactionHint,
							})),
							viewpoints: scene.sceneData.viewpoints.map((v) => v.name),
							environment: scene.sceneData.environment,
						}),
					},
				],
				details: { sceneId: scene.sceneId },
			};
		},
	};
}
