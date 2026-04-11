import type { BehaviorContext, DisplayConfig, SkillHandler } from "../types.js";

export const textDisplaySkill: SkillHandler = {
	name: "text-display",
	description:
		"Show a static markdown text panel when the player interacts with the object. Useful for signs, information boards, menus, or any fixed textual content.",
	configSchema: {
		content: {
			description: "Markdown-formatted text to display. Supports **bold**, *italic*, and newlines.",
			required: true,
		},
		title: { description: "Panel title.", required: false },
	},
	async handle(ctx: BehaviorContext): Promise<DisplayConfig> {
		const content = String(ctx.config.content ?? "");
		const title = ctx.config.title ? String(ctx.config.title) : ctx.objectName;
		if (!content) {
			return { type: "markdown", content: "**配置错误:** content 字段缺失。", title: "错误" };
		}
		return { type: "markdown", content, title };
	},
};
