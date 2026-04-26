import type { ProviderRef, SceneData } from "../scene/types.js";

export interface ImagePromptContent {
	source: "uri";
	uri: string;
}

export interface MultiImagePromptEntry {
	azimuth: number;
	content: ImagePromptContent;
}

export interface GenerateOptions {
	style?: string; // e.g. "realistic", "low-poly", "cartoon"
	width?: number;
	height?: number;
	/** Single image URL — Marble type: "image" with source: "uri" */
	imageUrl?: string;
	/** Local file path — provider uploads to media-assets and uses source: "media_asset" */
	imageFilePath?: string;
	/** Multiple images with azimuth angles — Marble type: "multi-image" (URI source) */
	multiImageUrls?: MultiImagePromptEntry[];
	/** Multiple local file paths — azimuths auto-distributed evenly (0, 360/n, 720/n, …) */
	multiImageFilePaths?: string[];
	/** Video URL — Marble type: "video" */
	videoUrl?: string;
	/** Local video file path — provider uploads to media-assets and uses source: "media_asset" */
	videoFilePath?: string;
}

export interface EditOptions {
	preserveObjects?: string[]; // objectIds the provider should not remove
}

export interface ProviderResult {
	ref: ProviderRef;
	viewUrl: string;
	thumbnailUrl?: string;
	sceneData: SceneData; // provider-parsed, provider-agnostic scene graph
	/**
	 * When set, SceneManager will replace the literal string "{sceneId}" in this
	 * template with the newly-assigned sceneId and store the result as
	 * sceneData.splatUrl.  Use this when the splatUrl path cannot be known until
	 * the scene has been assigned its ID (e.g. the proxy route /splat/{sceneId}).
	 */
	splatUrlTemplate?: string;
}

export interface ProviderDescription {
	ref: ProviderRef;
	sceneData: SceneData;
}

// Core abstraction — all scene render providers implement this
export interface SceneRenderProvider {
	readonly name: string;

	/**
	 * When true, the provider generates the complete visual world on its own
	 * (e.g. Marble photorealistic splats). The agent must NOT write sceneCode —
	 * it should pass only a text prompt and let the provider handle rendering.
	 *
	 * When false (default), the agent writes sceneCode or sceneData directly
	 * via the generator-claude skill and the provider is bypassed.
	 */
	readonly providesOwnRendering?: boolean;

	// Generate a new scene from a text prompt
	generate(prompt: string, options?: GenerateOptions): Promise<ProviderResult>;

	// Incrementally edit an existing scene
	edit(ref: ProviderRef, instruction: string, options?: EditOptions): Promise<ProviderResult>;

	// Retrieve current scene state (for sync after external edits)
	describe(ref: ProviderRef): Promise<ProviderDescription>;

	// ── Async generation (optional) ───────────────────────────────────────
	// Providers that implement these two methods support non-blocking generation.
	// GenerationQueue calls startGeneration() once, then polls checkGeneration()
	// every few seconds until a ProviderResult is returned.

	/** Start a generation job. Returns an opaque operationId for polling. */
	startGeneration?(prompt: string, options?: GenerateOptions): Promise<{ operationId: string }>;

	/**
	 * Check the status of a previously started job.
	 * Returns null while the job is still in progress, or a ProviderResult when done.
	 * Throws on unrecoverable errors.
	 */
	checkGeneration?(operationId: string): Promise<ProviderResult | null>;
}
