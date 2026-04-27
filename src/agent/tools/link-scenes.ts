import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { randomUUID } from "crypto";
import type { SceneManager } from "../../scene/scene-manager.js";

const parameters = Type.Object({
	fromSceneId: Type.String({ description: "Scene to add the portal to (the scene the player departs from)" }),
	toSceneId: Type.String({ description: "Destination scene the portal leads to" }),
	label: Type.Optional(
		Type.String({
			description: "Display name shown above the portal. Defaults to the destination scene's title if omitted.",
		}),
	),
	position: Type.Optional(
		Type.Object(
			{ x: Type.Number(), y: Type.Number(), z: Type.Number() },
			{
				description:
					"World-space position for the portal in fromScene. " +
					"If omitted, the portal is placed at (2, 0, 2) — near the scene origin but out of the way.",
			},
		),
	),
	bidirectional: Type.Optional(
		Type.Boolean({
			description: "If true, also add a return portal in toScene pointing back to fromScene. Default false.",
		}),
	),
});

export function linkScenesTool(
	sceneManager: SceneManager,
	viewerUrl: (sceneId: string) => string,
): AgentTool<typeof parameters> {
	return {
		name: "link_scenes",
		label: "Link scenes with portal",
		description:
			"Connect two existing scenes with a portal so players can travel between them. " +
			"Creates a visible portal object in fromScene that teleports the player to toScene on approach. " +
			"Use after generating 2 or more related scenes to make them explorable as a connected world. " +
			"Set bidirectional=true to also add a return portal in the destination scene.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const [fromScene, toScene] = await Promise.all([
				sceneManager.getScene(params.fromSceneId),
				sceneManager.getScene(params.toSceneId),
			]);

			if (!fromScene) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Scene ${params.fromSceneId} not found` }) }],
					details: { error: "from_scene_not_found" },
				};
			}
			if (!toScene) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Scene ${params.toSceneId} not found` }) }],
					details: { error: "to_scene_not_found" },
				};
			}

			const toLabel = params.label ?? toScene.title;
			const fromLabel = fromScene.title;
			const pos = params.position ?? { x: 2, y: 0, z: 2 };

			const forwardPortal = {
				objectId: `portal_${randomUUID().slice(0, 8)}`,
				name: toLabel,
				type: "portal" as const,
				position: pos,
				description: `Portal to ${toScene.title}`,
				interactable: true,
				metadata: {
					targetSceneId: params.toSceneId,
					targetSceneName: toScene.title,
				},
			};

			const updated = await sceneManager.addPropsToScene(params.fromSceneId, [forwardPortal]);
			const results: Array<{ sceneId: string; title: string; portalId: string; direction: string }> = [
				{ sceneId: updated.sceneId, title: updated.title, portalId: forwardPortal.objectId, direction: "forward" },
			];

			if (params.bidirectional) {
				const returnPortal = {
					objectId: `portal_${randomUUID().slice(0, 8)}`,
					name: fromLabel,
					type: "portal" as const,
					position: { x: 2, y: 0, z: 2 },
					description: `Portal back to ${fromScene.title}`,
					interactable: true,
					metadata: {
						targetSceneId: params.fromSceneId,
						targetSceneName: fromScene.title,
					},
				};
				const updatedTo = await sceneManager.addPropsToScene(params.toSceneId, [returnPortal]);
				results.push({
					sceneId: updatedTo.sceneId,
					title: updatedTo.title,
					portalId: returnPortal.objectId,
					direction: "return",
				});
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							status: "ready",
							portals: results,
							fromViewUrl: viewerUrl(params.fromSceneId),
							message: `Portal created: "${fromScene.title}" → "${toScene.title}"${params.bidirectional ? " (bidirectional)" : ""}`,
						}),
					},
				],
				details: { fromSceneId: params.fromSceneId, toSceneId: params.toSceneId, sceneChanged: true },
			};
		},
	};
}
