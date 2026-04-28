import { completeSimple, getModel } from "@mariozechner/pi-ai";
import { randomUUID } from "crypto";
import type { NpcEvolutionEvent } from "../storage/types.js";
import { type MemoryEntry, memoryFacts } from "./memory.js";

export interface EvolutionLogEntry {
	id: string;
	triggeredAt: number;
	interactionCount: number;
	currentPersonality: string;
	suggestedDelta: string;
	status: "pending" | "approved" | "rejected";
	appliedAt?: number;
}

export type EvolutionStrategy = "innovate" | "balanced" | "harden" | "repair";

/** Select evolution strategy based on lifetime interaction count. */
export function selectEvolutionStrategy(interactionCount: number): EvolutionStrategy {
	if (interactionCount < 5) return "innovate";
	if (interactionCount <= 50) return "balanced";
	return "harden";
}

const STRATEGY_INSTRUCTIONS: Record<EvolutionStrategy, string> = {
	innovate: "这个NPC才刚开始与玩家互动，性格还未定型。鼓励大胆探索新特质，增加个性深度，改变幅度可达50%。",
	balanced: "根据经历适度成长，保留核心特质，改变幅度不超过30%。",
	harden: "这个NPC已与大量玩家互动，性格趋于成熟稳定。只做细微精炼（幅度<15%），强化已有特质，不引入大变化。",
	repair: "这个NPC长期无人问津。调整方向：增加亲和力和主动性，让TA更容易被玩家接近和感兴趣，可改变幅度达40%。",
};

function haiku() {
	const model = getModel("anthropic", "claude-haiku-4-5-20251001");
	if (process.env.ANTHROPIC_BASE_URL) model.baseUrl = process.env.ANTHROPIC_BASE_URL;
	return model;
}

function extractText(response: Awaited<ReturnType<typeof completeSimple>>): string {
	return response.content
		.filter((c) => c.type === "text")
		.map((c) => (c as { type: "text"; text: string }).text)
		.join("")
		.trim();
}

/**
 * Analyse whether this NPC's personality should evolve based on their accumulated
 * memories. Returns a 1-2 sentence suggested delta (in Chinese), or null if no
 * meaningful change is warranted.
 */
export async function generateEvolutionDiff(
	npcName: string,
	currentPersonality: string,
	memory: MemoryEntry[],
	strategy: EvolutionStrategy = "balanced",
): Promise<string | null> {
	if (memory.length === 0 && strategy !== "repair") return null;

	const strategyNote = STRATEGY_INSTRUCTIONS[strategy];
	const facts = memoryFacts(memory);

	const prompt =
		`NPC ${npcName} 的当前性格设定：\n${currentPersonality}\n\n` +
		(facts.length > 0 ? `TA 最近的记忆摘要：\n${facts.map((m) => `- ${m}`).join("\n")}\n\n` : "") +
		`进化策略（${strategy}）：${strategyNote}\n\n` +
		`根据以上信息，TA 的性格是否应该有所成长或变化？` +
		`如果有，请用1-2句话描述建议的改变（如"变得更加信任陌生人"、"对冒险更感兴趣"），` +
		`保留核心特质。` +
		`如果没有明显变化，只回复"无需改变"。`;

	try {
		const response = await completeSimple(haiku(), {
			systemPrompt: "你是NPC性格进化分析师，根据NPC的经历提出合理的性格成长建议。",
			messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
		});
		const raw = extractText(response);
		if (!raw || raw === "无需改变") return null;
		return raw;
	} catch {
		return null;
	}
}

/**
 * Merge the approved delta into the current personality.
 * Returns the updated personality string.
 */
export async function applyEvolutionDelta(npcName: string, currentPersonality: string, delta: string): Promise<string> {
	const prompt =
		`NPC ${npcName} 的当前性格：\n${currentPersonality}\n\n` +
		`已批准的性格改变：\n${delta}\n\n` +
		`请将改变融入原性格，输出新的性格描述（不超过原长度的130%，保留核心特质，口语化，1-3句话）。` +
		`只输出新的性格描述，不要其他文字。`;

	try {
		const response = await completeSimple(haiku(), {
			systemPrompt: "你是NPC性格编辑助手，将性格改变自然地融入原有描述。",
			messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
		});
		return extractText(response) || currentPersonality;
	} catch {
		return currentPersonality;
	}
}

export function createEvolutionEntry(
	currentPersonality: string,
	suggestedDelta: string,
	interactionCount: number,
): EvolutionLogEntry {
	return {
		id: randomUUID().slice(0, 8),
		triggeredAt: Date.now(),
		interactionCount,
		currentPersonality,
		suggestedDelta,
		status: "pending",
	};
}

export function createNpcEvolutionEvent(
	npcId: string,
	sceneId: string,
	trigger: NpcEvolutionEvent["trigger"],
	strategy: EvolutionStrategy,
	interactionCount: number,
	currentPersonality: string,
	suggestedDelta: string,
): NpcEvolutionEvent {
	return {
		eventId: randomUUID().slice(0, 8),
		npcId,
		sceneId,
		trigger,
		strategy,
		interactionCount,
		currentPersonality,
		suggestedDelta,
		status: "pending",
		createdAt: Date.now(),
	};
}
