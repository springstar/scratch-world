import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { randomUUID } from "crypto";
import type { SceneManager } from "../../scene/scene-manager.js";
import { registerPicker } from "../../viewer-api/position-picker-registry.js";
import type { RealtimeBus } from "../../viewer-api/realtime.js";

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

async function requestPositionPick(
	bus: RealtimeBus,
	sessionId: string,
	sceneId: string,
	panoUrl: string,
	objectName: string,
	estimatedPos: { x: number; y: number; z: number },
): Promise<{ x: number; y: number; z: number }> {
	if (!bus.hasSubscribers(sessionId)) return estimatedPos;
	const pickerId = randomUUID();
	const promise = registerPicker(pickerId, estimatedPos);
	bus.publish(sessionId, { type: "position_picker", pickerId, panoUrl, estimatedPos, objectName, sceneId });
	return promise;
}

export function placePropTool(
	sceneManager: SceneManager,
	viewerUrl: (sceneId: string) => string,
	bus?: RealtimeBus,
	sessionId?: string,
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

			// For Marble (splat) scenes with a viewer open, show position picker for each prop
			// that has an explicit playerPosition estimate (not near_camera defaults).
			const meta = scene.sceneData.objects[0]?.metadata as Record<string, unknown> | undefined;
			const panoUrl = (typeof meta?.panoUrl === "string" ? meta.panoUrl : null) ?? "";
			const shouldPick = !!(bus && sessionId && panoUrl);

			const newObjects: Array<{
				objectId: string;
				name: string;
				type: "prop";
				position: { x: number; y: number; z: number };
				description: string;
				interactable: boolean;
				interactionHint?: string;
				metadata: Record<string, unknown>;
			}> = [];

			for (const p of params.props) {
				let position = p.metadata.playerPosition ?? { x: 0, y: 0, z: 0 };

				// Only show picker when an estimated position is provided (not default 0,0,0)
				if (
					shouldPick &&
					p.metadata.playerPosition &&
					(p.metadata.playerPosition.x !== 0 || p.metadata.playerPosition.z !== 0)
				) {
					position = await requestPositionPick(
						bus!,
						sessionId!,
						params.sceneId,
						panoUrl,
						p.name,
						p.metadata.playerPosition,
					);
				}

				newObjects.push({
					objectId: `prop_${randomUUID().slice(0, 8)}`,
					name: p.name,
					type: "prop",
					position,
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
				});
			}

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
