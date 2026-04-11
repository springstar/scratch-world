import type { BehaviorContext, DisplayConfig, SkillHandler } from "../types.js";

export const webViewSkill: SkillHandler = {
	name: "web-view",
	description: "Embed any web page (URL) in a panel when the player interacts with the object.",
	configSchema: {
		url: { description: "The URL to embed. Must be HTTPS and allow iframe embedding.", required: true },
		title: { description: "Panel title shown above the iframe.", required: false },
	},
	async handle(ctx: BehaviorContext): Promise<DisplayConfig> {
		const url = String(ctx.config.url ?? "");
		const title = ctx.config.title ? String(ctx.config.title) : ctx.objectName;
		if (!url.startsWith("https://") && !url.startsWith("http://")) {
			return { type: "markdown", content: `**配置错误:** url 字段缺失或非法。`, title: "错误" };
		}
		return { type: "iframe", url, title };
	},
};
