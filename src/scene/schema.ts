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

export const SceneDataSchema = Type.Object({
	objects: Type.Array(SceneObjectSchema),
	environment: EnvironmentConfigSchema,
	viewpoints: Type.Array(ViewpointSchema),
	sceneCode: Type.Optional(Type.String()),
});
