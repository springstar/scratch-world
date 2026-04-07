/**
 * npc-skills.ts
 *
 * Defines the NPC skill catalog.  Each skill is a capability package that can be
 * assigned to an NPC through the management UI and stored in npcSkills metadata.
 *
 * A skill contributes:
 *   - promptHint: text injected into the NPC's system prompt to shape behaviour
 *   - buildTool?: factory that creates an AgentTool added to the agent loop
 *
 * Skills are loaded at interaction time via loadNpcSkills().
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { RealtimeBus } from "../viewer-api/realtime.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface NpcSkillMeta {
	id: string;
	name: string; // Chinese display name
	description: string; // shown in management UI
}

interface SkillCtx {
	npcId: string;
	npcName: string;
	sessionId: string;
	sceneId: string;
	bus: RealtimeBus;
}

interface NpcSkillDef extends NpcSkillMeta {
	promptHint: string;
	buildTool?: (ctx: SkillCtx) => AgentTool;
}

// ── Catalog ──────────────────────────────────────────────────────────────────

const CATALOG: NpcSkillDef[] = [
	{
		id: "heal",
		name: "医疗",
		description: "能诊断症状、推荐药方，承担医者角色",
		promptHint:
			"你是有经验的医者，擅长通过询问症状进行诊断，能给出实用的医疗建议和处方。" + "对病人态度耐心，措辞简练。",
	},
	{
		id: "trade",
		name: "交易",
		description: "能和玩家进行物品交易、报价、讨价还价",
		promptHint: "你是一名商人，善于交易和讨价还价。" + "可以主动提出交易方案，用 offer_trade 工具正式发布报价。",
		buildTool: ({ npcId, npcName, sessionId, sceneId, bus }) => ({
			name: "offer_trade",
			description: "向玩家发出交易邀约",
			parameters: Type.Object({
				item: Type.String({ description: "交易物品名称" }),
				price: Type.String({ description: "报价（货币或等价物）" }),
			}),
			label: "发出报价",
			execute: async (_id, params) => {
				const { item, price } = params as { item: string; price: string };
				bus.publish(sessionId, {
					type: "npc_trade_offer",
					npcId,
					npcName,
					item,
					price,
					sceneId,
				});
				return {
					content: [{ type: "text", text: `已向玩家提出交易：${item}，报价 ${price}` }],
					details: null,
				};
			},
		}),
	},
	{
		id: "guide",
		name: "向导",
		description: "熟悉地图，能带路或在场景中标记导航点",
		promptHint:
			"你熟悉这片区域的每个角落，能给玩家指路或陪同带路。" +
			"遇到需要标记位置时，用 mark_waypoint 工具在地图上留下导航标记。",
		buildTool: ({ npcId, npcName, sessionId, sceneId, bus }) => ({
			name: "mark_waypoint",
			description: "在场景中标记一个导航点",
			parameters: Type.Object({
				x: Type.Number({ description: "标记位置 X 坐标" }),
				z: Type.Number({ description: "标记位置 Z 坐标" }),
				label: Type.String({ description: "导航点名称或说明" }),
			}),
			label: "标记位置",
			execute: async (_id, params) => {
				const { x, z, label } = params as { x: number; z: number; label: string };
				bus.publish(sessionId, {
					type: "npc_waypoint",
					npcId,
					npcName,
					position: { x, z },
					label,
					sceneId,
				});
				return {
					content: [{ type: "text", text: `已标记导航点「${label}」在 (${x.toFixed(1)}, ${z.toFixed(1)})` }],
					details: null,
				};
			},
		}),
	},
	{
		id: "quest",
		name: "任务发布",
		description: "能给玩家发布任务、设置目标和奖励",
		promptHint: "你有权向玩家发布任务。当玩家准备好时，用 assign_quest 工具正式下达任务、" + "说明目标和奖励。",
		buildTool: ({ npcId, npcName, sessionId, sceneId, bus }) => ({
			name: "assign_quest",
			description: "向玩家正式发布一项任务",
			parameters: Type.Object({
				title: Type.String({ description: "任务名称" }),
				objective: Type.String({ description: "任务目标（一句话说明）" }),
				reward: Type.String({ description: "完成后的奖励描述" }),
			}),
			label: "发布任务",
			execute: async (_id, params) => {
				const { title, objective, reward } = params as { title: string; objective: string; reward: string };
				bus.publish(sessionId, {
					type: "npc_quest",
					npcId,
					npcName,
					title,
					objective,
					reward,
					sceneId,
				});
				return {
					content: [{ type: "text", text: `任务「${title}」已发布：${objective}，奖励：${reward}` }],
					details: null,
				};
			},
		}),
	},
	{
		id: "teach",
		name: "授课",
		description: "能传授知识、技艺，解释场景中的事物",
		promptHint: "你是老师或师傅，善于传授知识和技能。" + "遇到可以教导的内容时，耐心解释，由浅入深，鼓励提问。",
	},
	{
		id: "storytell",
		name: "说书",
		description: "能讲述传说、历史故事或个人经历",
		promptHint: "你是天生的说书人，能把传说、历史和亲身经历讲得引人入胜。" + "善用细节和情感，让听者身临其境。",
	},
	{
		id: "guard",
		name: "守卫",
		description: "守护场所安全，能识别威胁并发出警告",
		promptHint:
			"你是一名尽职的守卫，时刻保持警惕，守护场所和人员安全。" + "遇到可疑情况会立刻盘问，对确认威胁发出严厉警告。",
	},
	{
		id: "cook",
		name: "烹饪",
		description: "精通厨艺，能分享食谱、美食知识和烹饪技巧",
		promptHint: "你是厨艺高手，了解各种食材和烹饪方法。" + "乐于分享食谱、食材知识，有时会用食物做比喻表达哲理。",
	},
];

// ── Public API ────────────────────────────────────────────────────────────────

/** Catalog metadata for the UI (no tool logic). */
export const NPC_SKILL_CATALOG: NpcSkillMeta[] = CATALOG.map(({ id, name, description }) => ({
	id,
	name,
	description,
}));

/**
 * Load the skills for an NPC and return prompt additions + tools to inject.
 * Unknown skill IDs are silently ignored.
 */
export function loadNpcSkills(skillIds: string[], ctx: SkillCtx): { promptAdditions: string[]; tools: AgentTool[] } {
	const promptAdditions: string[] = [];
	const tools: AgentTool[] = [];

	for (const id of skillIds) {
		const def = CATALOG.find((s) => s.id === id);
		if (!def) continue;
		promptAdditions.push(`[技能：${def.name}] ${def.promptHint}`);
		if (def.buildTool) tools.push(def.buildTool(ctx));
	}

	return { promptAdditions, tools };
}
