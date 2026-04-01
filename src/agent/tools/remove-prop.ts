import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the scene containing the prop" }),
	objectId: Type.String({ description: "objectId of the prop to remove (e.g. 'prop_073e64af')" }),
});

export function removePropTool(sceneManager: SceneManager): AgentTool<typeof parameters> {
	return {
		name: "remove_prop",
		label: "Remove physical prop",
		description:
			"Remove a physical prop from an existing scene by its objectId. " +
			"Use this when the user wants to delete, remove, or clear a previously placed prop. " +
			"Call list_scenes or ask the user for the objectId if unknown. " +
			"Does NOT regenerate the scene — only removes the object from the prop list.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			try {
				const updated = await sceneManager.removePropFromScene(params.sceneId, params.objectId);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								ok: true,
								sceneId: updated.sceneId,
								version: updated.version,
								removedObjectId: params.objectId,
							}),
						},
					],
					details: { sceneId: updated.sceneId, version: updated.version, sceneChanged: true },
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
						},
					],
					details: { error: String(err) },
				};
			}
		},
	};
}
