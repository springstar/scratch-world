import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { randomUUID } from "crypto";
import type { SceneManager } from "../../scene/scene-manager.js";

const PropMetadataSchema = Type.Object({
	modelUrl: Type.String({ description: "CDN-accessible GLB/GLTF URL for the prop model" }),
	physicsShape: Type.Optional(
		Type.Union([Type.Literal("box"), Type.Literal("sphere"), Type.Literal("convex")], {
			description: "Rapier collider shape (default: box)",
		}),
	),
	mass: Type.Optional(Type.Number({ description: "Mass in kg (default 10)" })),
	scale: Type.Optional(Type.Number({ description: "World scale multiplier (default 1)" })),
	targetHeight: Type.Optional(
		Type.Number({
			description:
				"Target real-world height in metres. The viewer scales the model so its bounding-box height matches this value. " +
				"Set based on semantic category: human/humanoid 1.7, child 1.2, cat 0.3, dog 0.5, horse 1.6, chair 0.9, table 0.75, bicycle 1.0. " +
				"ALWAYS set this field — it ensures correct proportions relative to other scene objects.",
		}),
	),
	placement: Type.Optional(
		Type.Union(
			[
				Type.Literal("near_camera"),
				Type.Literal("near_entrance"),
				Type.Literal("scene_center"),
				Type.Literal("exact"),
			],
			{
				description:
					"Where to place the prop. Use 'exact' when a [点击目标] coordinate is provided — the prop lands at the exact clicked position. Use 'near_camera' when only player position is known.",
			},
		),
	),
	playerPosition: Type.Optional(
		Type.Object(
			{
				x: Type.Number(),
				y: Type.Number(),
				z: Type.Number(),
			},
			{
				description:
					"World-space anchor position for placement. " +
					"If a [点击目标] prefix appears in the message, copy those coordinates here — they are the click-raycast hit point and give the most accurate placement. " +
					"Otherwise copy from the [玩家当前位置] prefix when available. " +
					"Used by the viewer to place the prop near the specified point.",
			},
		),
	),
});

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the Marble scene to add props to" }),
	props: Type.Array(
		Type.Object({
			name: Type.String({ description: "Display name for the prop (e.g. 'Wooden Crate')" }),
			description: Type.String({ description: "What the prop is" }),
			interactable: Type.Optional(
				Type.Boolean({ description: "Whether the player can interact with it (default true)" }),
			),
			interactionHint: Type.Optional(Type.String({ description: "Hint shown to player (e.g. 'Push the crate')" })),
			metadata: PropMetadataSchema,
		}),
		{ description: "Props to add. Each gets auto-placed on the scene floor near the spawn point." },
	),
});

export function placePropTool(
	sceneManager: SceneManager,
	viewerUrl: (sceneId: string) => string,
): AgentTool<typeof parameters> {
	return {
		name: "place_prop",
		label: "Place physical prop",
		description:
			"Add one or more physical, interactive objects to an existing Marble (splat) scene. " +
			"Use this instead of update_scene when the user wants to place objects they can push, pick up, or interact with. " +
			"Does NOT regenerate the scene — only appends objects to the scene's prop list. " +
			"modelUrl must be a CDN-accessible GLB/GLTF (use asset catalog or find_gltf_assets).",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const scene = await sceneManager.getScene(params.sceneId);
			if (!scene) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Scene ${params.sceneId} not found` }) }],
					details: { error: "scene not found" },
				};
			}

			const newObjects = params.props.map((p) => ({
				objectId: `prop_${randomUUID().slice(0, 8)}`,
				name: p.name,
				type: "prop" as const,
				position: { x: 0, y: 0, z: 0 }, // viewer placement logic overrides this
				description: p.description,
				interactable: p.interactable ?? true,
				interactionHint: p.interactionHint,
				metadata: {
					...p.metadata,
					physicsShape: p.metadata.physicsShape ?? "box",
					mass: p.metadata.mass ?? 10,
					scale: p.metadata.scale ?? 1,
					placement: p.metadata.placement ?? "near_camera",
				},
			}));

			const updated = await sceneManager.addPropsToScene(params.sceneId, newObjects);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							sceneId: updated.sceneId,
							title: updated.title,
							version: updated.version,
							status: "ready",
							viewUrl: viewerUrl(updated.sceneId),
							addedProps: newObjects.map((o) => ({ id: o.objectId, name: o.name })),
						}),
					},
				],
				details: { sceneId: updated.sceneId, version: updated.version, sceneChanged: true },
			};
		},
	};
}
