import { Type } from "@sinclair/typebox";

export const Vec3Schema = Type.Object({
	x: Type.Number(),
	y: Type.Number(),
	z: Type.Number(),
});

export const SceneObjectSchema = Type.Object({
	objectId: Type.String(),
	name: Type.String(),
	type: Type.String(),
	position: Vec3Schema,
	description: Type.String(),
	interactable: Type.Boolean(),
	interactionHint: Type.Optional(Type.String()),
	metadata: Type.Record(Type.String(), Type.Unknown()),
});

export const BloomEffectSchema = Type.Object({
	strength: Type.Optional(Type.Number()),
	radius: Type.Optional(Type.Number()),
	threshold: Type.Optional(Type.Number()),
});

export const EffectsSchema = Type.Object({
	bloom: Type.Optional(BloomEffectSchema),
});

export const EnvironmentConfigSchema = Type.Object({
	skybox: Type.Optional(Type.String()),
	skyboxUrl: Type.Optional(
		Type.String({ description: "Equirectangular panorama URL — overrides the procedural sky" }),
	),
	ambientLight: Type.Optional(Type.String()),
	weather: Type.Optional(Type.String()),
	timeOfDay: Type.Optional(Type.String()),
	effects: Type.Optional(EffectsSchema),
});

export const ViewpointSchema = Type.Object({
	viewpointId: Type.String(),
	name: Type.String(),
	position: Vec3Schema,
	lookAt: Vec3Schema,
});

export const SpawnPointSchema = Type.Object({
	id: Type.String(),
	label: Type.String({ description: "Semantic name shown in the UI, e.g. 铁匠铺门口" }),
	x: Type.Number(),
	z: Type.Number(),
});

export const SceneDataSchema = Type.Object({
	objects: Type.Array(SceneObjectSchema),
	environment: EnvironmentConfigSchema,
	viewpoints: Type.Array(ViewpointSchema),
	sceneCode: Type.Optional(Type.String()),
	splatUrl: Type.Optional(
		Type.String({
			description: "URL to a Gaussian splat file (.spz/.ply/.splat) — activates SplatViewer in the browser",
		}),
	),
	colliderMeshUrl: Type.Optional(
		Type.String({
			description: "URL to physics collision mesh (.glb) — public CDN, no auth required",
		}),
	),
	spawnPoints: Type.Optional(
		Type.Array(SpawnPointSchema, {
			description: "LLM-suggested NPC placement positions, quick-selected in the NPC drawer",
		}),
	),
});
