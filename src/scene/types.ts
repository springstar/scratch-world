export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export interface Viewpoint {
	viewpointId: string;
	name: string; // e.g. "main gate", "throne room"
	position: Vec3;
	lookAt: Vec3;
}

export interface SceneObject {
	objectId: string;
	name: string;
	type: string; // "building", "tree", "npc", "item", etc.
	position: Vec3;
	description: string;
	interactable: boolean;
	interactionHint?: string; // shown to user: "try 'open the chest'"
	metadata: Record<string, unknown>;
}

export interface EnvironmentConfig {
	skybox?: string; // e.g. "sunset", "overcast"
	skyboxUrl?: string; // equirectangular panorama URL (overrides procedural sky)
	ambientLight?: string;
	weather?: string;
	timeOfDay?: string;
	effects?: {
		bloom?: { strength?: number; radius?: number; threshold?: number };
	};
}

export interface SceneData {
	objects: SceneObject[];
	environment: EnvironmentConfig;
	viewpoints: Viewpoint[];
	sceneCode?: string;
	splatUrl?: string; // URL to a Gaussian splat file (.spz / .ply / .splat) — activates SplatViewer
}

// Opaque per-provider pointer to the generated asset
export interface ProviderRef {
	provider: string; // "marble" | "stub" | ...
	assetId: string;
	viewUrl?: string; // shareable link sent back to the user
	editToken?: string; // token for incremental edits (provider-dependent)
}

export interface Scene {
	sceneId: string;
	ownerId: string; // userId from the channel
	title: string;
	description: string;
	sceneData: SceneData;
	providerRef: ProviderRef;
	version: number; // incremented on every update
	createdAt: number;
	updatedAt: number;
	isPublic: boolean; // true = anyone with the share link can view
	shareToken?: string; // opaque token appended to viewer URL for access
}

export interface SceneVersion {
	sceneId: string;
	version: number;
	sceneData: SceneData;
	providerRef: ProviderRef;
	createdAt: number;
}
