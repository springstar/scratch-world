import { codeGenSkill } from "./skills/code-gen.js";
import { stockTickerSkill } from "./skills/stock-ticker.js";
import { textDisplaySkill } from "./skills/text-display.js";
import { videoPlayerSkill } from "./skills/video-player.js";
import { webViewSkill } from "./skills/web-view.js";
import type { BehaviorContext, DisplayConfig, SkillHandler } from "./types.js";

const BUILT_IN: SkillHandler[] = [webViewSkill, stockTickerSkill, videoPlayerSkill, textDisplaySkill, codeGenSkill];

export class BehaviorRegistry {
	private handlers = new Map<string, SkillHandler>();

	constructor() {
		for (const skill of BUILT_IN) {
			this.handlers.set(skill.name, skill);
		}
	}

	register(handler: SkillHandler): this {
		this.handlers.set(handler.name, handler);
		return this;
	}

	get(name: string): SkillHandler | undefined {
		return this.handlers.get(name);
	}

	list(): SkillHandler[] {
		return [...this.handlers.values()];
	}

	async run(ctx: BehaviorContext): Promise<DisplayConfig | null> {
		const skillName = ctx.config.name;
		if (typeof skillName !== "string") return null;
		const handler = this.handlers.get(skillName);
		if (!handler) return null;
		const skillConfig = (ctx.config.config as Record<string, unknown>) ?? {};
		return handler.handle({ ...ctx, config: skillConfig });
	}
}

export const behaviorRegistry = new BehaviorRegistry();
