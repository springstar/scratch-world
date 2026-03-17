import { randomUUID } from "crypto";
import type { ProviderRef, SceneData } from "../../scene/types.js";
import type { EditOptions, GenerateOptions, ProviderDescription, ProviderResult, ThreeDProvider } from "../types.js";

function makeSceneData(prompt: string, extra?: Partial<SceneData>): SceneData {
	return {
		environment: {
			skybox: "clear_day",
			ambientLight: "warm",
			weather: "clear",
			timeOfDay: "noon",
		},
		viewpoints: [
			{
				viewpointId: "vp_entrance",
				name: "entrance",
				position: { x: 0, y: 1.7, z: -10 },
				lookAt: { x: 0, y: 1, z: 0 },
			},
			{
				viewpointId: "vp_overview",
				name: "overview",
				position: { x: 0, y: 20, z: -20 },
				lookAt: { x: 0, y: 0, z: 0 },
			},
		],
		objects: [
			{
				objectId: "obj_ground",
				name: "ground",
				type: "terrain",
				position: { x: 0, y: 0, z: 0 },
				description: `Ground plane for: ${prompt}`,
				interactable: false,
				metadata: {},
			},
			{
				objectId: "obj_main",
				name: "main structure",
				type: "building",
				position: { x: 0, y: 0, z: 0 },
				description: `Main structure generated from: "${prompt}"`,
				interactable: true,
				interactionHint: "try 'examine the structure'",
				metadata: { prompt },
			},
		],
		...extra,
	};
}

export class StubProvider implements ThreeDProvider {
	readonly name = "stub";

	async generate(prompt: string, _options?: GenerateOptions): Promise<ProviderResult> {
		const assetId = randomUUID();
		const ref: ProviderRef = {
			provider: "stub",
			assetId,
			viewUrl: `https://stub.local/scenes/${assetId}`,
			editToken: `edit_${assetId}`,
		};
		const sceneData = makeSceneData(prompt);
		return {
			ref,
			viewUrl: ref.viewUrl!,
			thumbnailUrl: `https://stub.local/scenes/${assetId}/thumb.png`,
			sceneData,
		};
	}

	async edit(ref: ProviderRef, instruction: string, _options?: EditOptions): Promise<ProviderResult> {
		// Simulate an edit by appending a new object to the scene
		const newObjectId = `obj_${randomUUID().slice(0, 8)}`;
		const editedSceneData = makeSceneData(`[edited] ${instruction}`, {
			objects: [
				{
					objectId: "obj_ground",
					name: "ground",
					type: "terrain",
					position: { x: 0, y: 0, z: 0 },
					description: "Ground plane",
					interactable: false,
					metadata: {},
				},
				{
					objectId: "obj_main",
					name: "main structure",
					type: "building",
					position: { x: 0, y: 0, z: 0 },
					description: "Main structure (edited)",
					interactable: true,
					interactionHint: "try 'examine the structure'",
					metadata: {},
				},
				{
					objectId: newObjectId,
					name: instruction,
					type: "object",
					position: { x: 5, y: 0, z: 5 },
					description: `Added by edit: "${instruction}"`,
					interactable: true,
					interactionHint: `try 'interact with ${instruction}'`,
					metadata: { instruction },
				},
			],
		});

		const updatedRef: ProviderRef = {
			...ref,
			viewUrl: `${ref.viewUrl}?v=${Date.now()}`,
		};

		return {
			ref: updatedRef,
			viewUrl: updatedRef.viewUrl!,
			sceneData: editedSceneData,
		};
	}

	async describe(ref: ProviderRef): Promise<ProviderDescription> {
		return {
			ref,
			sceneData: makeSceneData(`stub scene ${ref.assetId}`),
		};
	}
}
