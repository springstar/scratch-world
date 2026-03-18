import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the scene" }),
	objectId: Type.String({ description: "ID of the object to interact with" }),
	action: Type.String({ description: "The action to perform, e.g. 'open', 'examine', 'pick up'" }),
});

export function interactWithObjectTool(sceneManager: SceneManager): AgentTool<typeof parameters> {
	return {
		name: "interact_with_object",
		label: "Interact with object",
		description:
			"Perform an action on an interactable object in a scene. Use this when the user tries to touch, open, examine, or otherwise interact with something in the world.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const result = await sceneManager.interactWithObject(params.sceneId, params.objectId, params.action);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							outcome: result.outcome,
							sceneChanged: result.sceneChanged,
						}),
					},
				],
				details: { sceneId: params.sceneId, objectId: params.objectId, sceneChanged: result.sceneChanged },
			};
		},
	};
}
