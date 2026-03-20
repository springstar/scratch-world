import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";
import { SceneDataSchema } from "../../scene/schema.js";

const parameters = Type.Object({
	prompt: Type.String({ description: "Detailed description of the scene to generate" }),
	title: Type.Optional(Type.String({ description: "Short title for the scene (max 60 chars)" })),
	sceneData: Type.Optional(SceneDataSchema),
	sceneCode: Type.Optional(
		Type.String({
			description:
				"Optional self-contained Three.js JS code to render the scene. When provided, this overrides or supplements sceneData rendering.",
		}),
	),
});

export function createSceneTool(
	sceneManager: SceneManager,
	ownerId: () => string,
	viewerUrl: (sceneId: string) => string,
): AgentTool<typeof parameters> {
	return {
		name: "create_scene",
		label: "Create 3D scene",
		description:
			"Generate a new 3D scene from a text prompt. Use this when the user wants to create a new world, environment, or location.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			// Merge sceneCode into sceneData if provided
			const mergedSceneData = params.sceneCode
				? {
						...(params.sceneData ?? { objects: [], environment: {}, viewpoints: [] }),
						sceneCode: params.sceneCode,
					}
				: params.sceneData;
			const scene = await sceneManager.createScene(ownerId(), params.prompt, params.title, mergedSceneData);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							sceneId: scene.sceneId,
							title: scene.title,
							viewUrl: viewerUrl(scene.sceneId),
							objects: scene.sceneData.objects.map((o) => ({ id: o.objectId, name: o.name, type: o.type })),
							viewpoints: scene.sceneData.viewpoints.map((v) => v.name),
						}),
					},
				],
				details: { sceneId: scene.sceneId, title: scene.title },
			};
		},
	};
}
