/** Runtime behavior skill system — types shared across registry and skill handlers. */

export interface BehaviorContext {
	objectId: string;
	objectName: string;
	sceneId: string;
	playerPosition?: { x: number; y: number; z: number };
	objectPosition?: { x: number; y: number; z: number };
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
	| { type: "tv"; content: string; title?: string };

export interface SkillHandler {
	/** Machine-readable name used in metadata.skill.name */
	name: string;
	/** One-line description for Claude's SKILL.md */
	description: string;
	/** Required config keys with descriptions — shown to Claude when attaching */
	configSchema: Record<string, { description: string; required: boolean }>;
	handle(ctx: BehaviorContext): Promise<DisplayConfig>;
}
