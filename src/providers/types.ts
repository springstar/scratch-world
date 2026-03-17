import type { ProviderRef, SceneData } from "../scene/types.js";

export interface GenerateOptions {
	style?: string; // e.g. "realistic", "low-poly", "cartoon"
	width?: number;
	height?: number;
}

export interface EditOptions {
	preserveObjects?: string[]; // objectIds the provider should not remove
}

export interface ProviderResult {
	ref: ProviderRef;
	viewUrl: string;
	thumbnailUrl?: string;
	sceneData: SceneData; // provider-parsed, provider-agnostic scene graph
}

export interface ProviderDescription {
	ref: ProviderRef;
	sceneData: SceneData;
}

// Core abstraction — all 3D providers implement this
export interface ThreeDProvider {
	readonly name: string;

	// Generate a new scene from a text prompt
	generate(prompt: string, options?: GenerateOptions): Promise<ProviderResult>;

	// Incrementally edit an existing scene
	edit(ref: ProviderRef, instruction: string, options?: EditOptions): Promise<ProviderResult>;

	// Retrieve current scene state (for sync after external edits)
	describe(ref: ProviderRef): Promise<ProviderDescription>;
}
