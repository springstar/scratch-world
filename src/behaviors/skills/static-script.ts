import type { BehaviorContext, DisplayConfig, SkillHandler } from "../types.js";

export const staticScriptSkill: SkillHandler = {
	name: "static-script",
	description:
		"Runs a pre-written JavaScript snippet in the WorldAPI sandbox. Use when the exact code is already known and LLM generation is not needed.",
	configSchema: {
		code: { description: "Raw JavaScript to execute in the WorldAPI sandbox.", required: true },
		title: { description: "Optional label shown in the activation button.", required: false },
	},
	async handle(ctx: BehaviorContext): Promise<DisplayConfig> {
		const code = ctx.config.code ? String(ctx.config.code) : null;
		if (!code) {
			return { type: "markdown", content: "**配置错误:** static-script skill 缺少 `code` 字段。", title: "错误" };
		}
		const title = ctx.config.title ? String(ctx.config.title) : "脚本";
		return { type: "script", code, title };
	},
};
