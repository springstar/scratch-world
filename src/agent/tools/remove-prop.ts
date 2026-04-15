import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the scene containing the object" }),
	objectId: Type.Optional(
		Type.String({
			description:
				"objectId of a single object to remove (e.g. 'prop_073e64af' or 'npc_abc123'). " +
				"Use this when removing one specific object. Omit when using 'name' for batch removal.",
		}),
	),
	name: Type.Optional(
		Type.String({
			description:
				"Remove ALL objects whose name matches this value (case-insensitive). " +
				"Use this to delete every NPC or prop with a given name in one call. " +
				"Omit when using 'objectId' for single removal.",
		}),
	),
});

export function removePropTool(sceneManager: SceneManager): AgentTool<typeof parameters> {
	return {
		name: "remove_prop",
		label: "Remove physical prop or NPC",
		description:
			"Remove one or more objects from an existing scene. " +
			"To remove a single known object, provide 'objectId'. " +
			"To remove ALL objects with a given name (e.g. all NPCs named 'Joyce'), provide 'name' — this removes every match in one call. " +
			"Does NOT regenerate the scene — only removes the object(s) from the list.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			try {
				if (params.name) {
					const { scene, removedCount } = await sceneManager.removeObjectsByName(params.sceneId, params.name);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									sceneId: scene.sceneId,
									version: scene.version,
									removedCount,
									name: params.name,
								}),
							},
						],
						details: { sceneId: scene.sceneId, version: scene.version, sceneChanged: removedCount > 0 },
					};
				}

				if (!params.objectId) {
					return {
						content: [{ type: "text", text: JSON.stringify({ error: "Provide either objectId or name" }) }],
						details: { error: "missing params" },
					};
				}

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
