/** Runtime behavior skill system — types shared across registry and skill handlers. */

export interface BehaviorContext {
	objectId: string;
	objectName: string;
	sceneId: string;
	playerPosition?: { x: number; y: number; z: number };
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
	| { type: "table"; headers: string[]; rows: string[][]; title?: string };

export interface SkillHandler {
	/** Machine-readable name used in metadata.skill.name */
	name: string;
	/** One-line description for Claude's SKILL.md */
	description: string;
	/** Required config keys with descriptions — shown to Claude when attaching */
	configSchema: Record<string, { description: string; required: boolean }>;
	handle(ctx: BehaviorContext): Promise<DisplayConfig>;
}
