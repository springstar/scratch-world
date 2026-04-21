/** Runtime behavior skill system — types shared across registry and skill handlers. */

import type { EnvironmentConfig } from "../scene/types.js";

/** A resource the skill identified as needed for generation. */
export interface ResourceNeed {
	/** Machine-readable kind — informs which picker options to show. */
	kind: "texture" | "model" | "audio" | "video";
	/** Human-readable description, e.g. "particle texture for fireworks burst" */
	label: string;
	/** Pre-selected option from the builtin catalog, if any. */
	suggested?: ResourceOption;
	/** Additional CDN-sourced options to offer the user. */
	options: ResourceOption[];
}

/** One selectable resource option. */
export interface ResourceOption {
	/** Unique identifier within this picker session. */
	id: string;
	/** Display name shown to user. */
	name: string;
	/** URL or path the generated code should use. */
	url: string;
	/** Optional thumbnail URL for preview. */
	thumbnail?: string;
	/** Where this resource comes from. */
	source: "builtin" | "cdn" | "upload";
}

/** User-confirmed resource choices — sent back in interactionData.confirmedResources. */
export interface ResourceChoice {
	/** Matches ResourceNeed.label */
	label: string;
	/** The chosen option. */
	option: ResourceOption;
}

export interface BehaviorContext {
	objectId: string;
	objectName: string;
	sceneId: string;
	playerPosition?: { x: number; y: number; z: number };
	objectPosition?: { x: number; y: number; z: number };
	/** Scene environment — weather, timeOfDay, skybox, lighting. Used by code-gen for scene-aware effects. */
	environment?: EnvironmentConfig;
	/** Calibrated display height for 3D mesh overlays (e.g. TV screen). Defaults to 1.3 if not set. */
	displayY?: number;
	/** Physical width of the display surface in metres (e.g. TV screen width). */
	displayWidth?: number;
	/** Physical height of the display surface in metres (e.g. TV screen height). */
	displayHeight?: number;
	config: Record<string, unknown>;
}

/**
 * What the viewer should display after a successful skill interaction.
 * Add new variants here and handle them in BehaviorOverlay.tsx.
 */
export type DisplayConfig =
	| { type: "iframe"; url: string; title?: string }
	| { type: "video"; url: string; title?: string }
	| { type: "markdown"; content: string; title?: string }
	| { type: "table"; headers: string[]; rows: string[][]; title?: string }
	/** Client executes `code` in a WorldAPI sandbox — no overlay is shown. */
	| { type: "script"; code: string; title?: string }
	/** Render HTML directly on the TV screen via screen-space projection. */
	| { type: "tv"; content: string; title?: string }
	/**
	 * Skill needs external resources before it can generate.
	 * Client shows a resource picker; user confirms then re-POSTs /interact with
	 * interactionData.confirmedResources = ResourceChoice[].
	 */
	| { type: "resource-picker"; needs: ResourceNeed[]; title?: string };

export interface SkillHandler {
	/** Machine-readable name used in metadata.skill.name */
	name: string;
	/** One-line description for Claude's SKILL.md */
	description: string;
	/** Required config keys with descriptions — shown to Claude when attaching */
	configSchema: Record<string, { description: string; required: boolean }>;
	handle(ctx: BehaviorContext): Promise<DisplayConfig>;
}
