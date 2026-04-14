import type { BehaviorContext, DisplayConfig, SkillHandler } from "../types.js";

/**
 * tv-display: render HTML directly on the TV screen via screen-space projection.
 * No LLM call — the agent writes the HTML content directly in the config.
 * The viewer's world.setTvContent() mechanism projects it onto the physical TV position.
 */
export const tvDisplaySkill: SkillHandler = {
	name: "tv-display",
	description:
		"Render HTML content directly on a TV screen, monitor, or display surface using screen-space projection. " +
		"Use this (not text-display or code-gen) for any TV, monitor, or screen object. " +
		"The content appears overlaid on the physical TV location in the 3D scene.",
	configSchema: {
		content: {
			description:
				"HTML string to display on the TV screen. Supports inline styles. " +
				"Example: '<h2 style=\"color:#fff\">欢迎光临</h2><p>Welcome</p>'",
			required: true,
		},
		title: { description: "Label shown on the interaction button.", required: false },
	},
	async handle(ctx: BehaviorContext): Promise<DisplayConfig> {
		const content = String(ctx.config.content ?? "");
		const title = ctx.config.title ? String(ctx.config.title) : ctx.objectName;
		if (!content) {
			return { type: "markdown", content: "**配置错误:** tv-display 缺少 `content` 字段。", title: "错误" };
		}
		return { type: "tv", content, title };
	},
};
