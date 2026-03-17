import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the scene" }),
	viewpoint: Type.String({ description: "Name of the viewpoint, e.g. 'entrance', 'throne room'" }),
});

export function navigateToTool(sceneManager: SceneManager): AgentTool<typeof parameters> {
	return {
		name: "navigate_to",
		label: "Navigate to viewpoint",
		description:
			"Move the user's perspective to a named viewpoint within a scene. Use this when the user wants to go somewhere or look at a specific area.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const result = await sceneManager.navigateTo(params.sceneId, params.viewpoint);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							viewpoint: result.viewpoint.name,
							viewUrl: result.viewUrl,
							description: result.description,
						}),
					},
				],
				details: { sceneId: params.sceneId, viewpoint: params.viewpoint },
			};
		},
	};
}
