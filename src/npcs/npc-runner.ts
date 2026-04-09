import { completeSimple, getModel } from "@mariozechner/pi-ai";
import { createLogger } from "../logger.js";

const COOLDOWN_MS = 10_000;
// npcId → timestamp of last reaction (in-memory, resets on process restart)
const cooldowns = new Map<string, number>();

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
 * Call Haiku with the NPC's personality + memory as system prompt and return a reply.
 * Passes the full conversation history as multi-turn messages so the NPC can build
 * on context from earlier exchanges rather than responding in isolation.
 *
 * Returns null if the NPC is still in cooldown or if the model returns nothing.
 *
 * @param memory - array of condensed memory facts from previous interactions
 * @param perceptionContext - optional snapshot of the NPC's immediate surroundings
 * @param conversationHistory - recent chat history from the frontend (last N turns)
 */
export async function reactAsNpc(
	npcId: string,
	npcName: string,
	personality: string,
	userText: string,
	memory: string[] = [],
	perceptionContext?: string,
	conversationHistory?: { role: "user" | "npc"; text: string }[],
): Promise<string | null> {
	const now = Date.now();
	if (now - (cooldowns.get(npcId) ?? 0) < COOLDOWN_MS) return null;
	cooldowns.set(npcId, now);

	const log = createLogger({ tool: "npc_react", npc: npcId });
	const t = log.timer("react");

	const memorySection = memory.length > 0 ? `\n\n[你记得的事情]\n${memory.map((m) => `- ${m}`).join("\n")}` : "";
	const perceptionSection = perceptionContext ? `\n\n[当前感知]\n${perceptionContext}` : "";

	// Inject recent conversation history into the system prompt so the NPC can
	// build on context from earlier exchanges in this session.
	const recentHistory = (conversationHistory ?? []).slice(-8);
	const historySection =
		recentHistory.length > 0
			? `\n\n[本次对话记录]\n${recentHistory.map((h) => (h.role === "user" ? `玩家：${h.text}` : `你：${h.text}`)).join("\n")}`
			: "";

	const systemPrompt = `你是${npcName}。${personality}${memorySection}${perceptionSection}${historySection}

以符合角色的方式自然回应玩家。根据对话内容决定回应长短，不要重复之前说过的话，不讨论游戏机制或角色无关话题。`;

	const response = await completeSimple(haiku(), {
		systemPrompt,
		messages: [{ role: "user", content: userText, timestamp: now }],
	});

	const reply = extractText(response) || null;
	t.end({ npcName, tokens: response.usage?.output });
	return reply;
}

/**
 * Cooldown-free variant of reactAsNpc used for NPC-to-NPC interactions.
 * Should not be called for player-initiated exchanges (use reactAsNpc instead).
 */
export async function reactAsNpcNoCD(
	npcId: string,
	npcName: string,
	personality: string,
	userText: string,
	memory: string[] = [],
	perceptionContext?: string,
): Promise<string | null> {
	const log = createLogger({ tool: "npc_react", npc: npcId });
	const t = log.timer("react_nocd");

	const memorySection = memory.length > 0 ? `\n\n[你记得的事情]\n${memory.map((m) => `- ${m}`).join("\n")}` : "";
	const perceptionSection = perceptionContext ? `\n\n[当前感知]\n${perceptionContext}` : "";

	const systemPrompt = `你是${npcName}。${personality}${memorySection}${perceptionSection}\n\n用1-2句话回应，保持角色，不讨论角色无关话题。`;

	const response = await completeSimple(haiku(), {
		systemPrompt,
		messages: [{ role: "user", content: userText, timestamp: Date.now() }],
	});

	const reply = extractText(response) || null;
	t.end({ npcName, tokens: response.usage?.output });
	return reply;
}

// Heartbeat cooldown: one spontaneous line per NPC per 4 minutes minimum
const heartbeatCooldowns = new Map<string, number>();
const HEARTBEAT_COOLDOWN_MS = 4 * 60 * 1000;

// Greeting cooldown: re-approaching the same NPC too quickly won't re-trigger greeting
const greetCooldowns = new Map<string, number>();
const GREET_COOLDOWN_MS = 60_000;

/**
 * Generate a spontaneous one-liner for an NPC (heartbeat / world tick).
 * Uses a separate cooldown track from reactAsNpc so chat and heartbeat don't block each other.
 * Returns null if the NPC is still in heartbeat cooldown.
 */
export async function spontaneousNpcLine(
	npcId: string,
	npcName: string,
	personality: string,
	memory: string[] = [],
	perceptionContext?: string,
): Promise<string | null> {
	const now = Date.now();
	if (now - (heartbeatCooldowns.get(npcId) ?? 0) < HEARTBEAT_COOLDOWN_MS) return null;
	heartbeatCooldowns.set(npcId, now);

	const log = createLogger({ tool: "npc_heartbeat", npc: npcId });
	const t = log.timer("spontaneous");

	const memorySection = memory.length > 0 ? `\n\n[你记得的事情]\n${memory.map((m) => `- ${m}`).join("\n")}` : "";
	const perceptionSection = perceptionContext ? `\n\n[当前感知]\n${perceptionContext}` : "";

	const systemPrompt = `你是${npcName}。${personality}${memorySection}${perceptionSection}\n\n此刻场景中没有人跟你说话，你自然地说出一句独白或感慨（1句，保持角色，口语化）。`;

	const response = await completeSimple(haiku(), {
		systemPrompt,
		messages: [{ role: "user", content: "（心跳触发）", timestamp: Date.now() }],
	});

	const reply = extractText(response) || null;
	t.end({ npcName });
	return reply;
}

/**
 * Generate a greeting line when a player first approaches this NPC.
 * Uses a separate cooldown (60 s) so repeated approaches are rate-limited server-side.
 * Returns null if still in cooldown.
 */
export async function greetAsNpc(
	npcId: string,
	npcName: string,
	personality: string,
	memory: string[] = [],
	perceptionContext?: string,
): Promise<string | null> {
	const now = Date.now();
	if (now - (greetCooldowns.get(npcId) ?? 0) < GREET_COOLDOWN_MS) return null;
	greetCooldowns.set(npcId, now);

	const log = createLogger({ tool: "npc_greet", npc: npcId });
	const t = log.timer("greet");

	const memorySection = memory.length > 0 ? `\n\n[你记得的事情]\n${memory.map((m) => `- ${m}`).join("\n")}` : "";
	const perceptionSection = perceptionContext ? `\n\n[当前感知]\n${perceptionContext}` : "";

	const systemPrompt = `你是${npcName}。${personality}${memorySection}${perceptionSection}\n\n玩家刚走近你，主动打一句招呼（1句，热情自然，符合角色）。`;

	const response = await completeSimple(haiku(), {
		systemPrompt,
		messages: [{ role: "user", content: "（玩家走近了）", timestamp: Date.now() }],
	});

	const reply = extractText(response) || null;
	t.end({ npcName });
	return reply;
}

// Memory items are capped at this count; older items are compressed if exceeded.
const MEMORY_CAP = 20;

/**
 * Given the just-completed exchange, extract 1-3 concise facts worth remembering
 * and merge with the existing memory array.
 *
 * Runs asynchronously — caller should not await this on the hot path.
 * Returns the updated memory array (at most MEMORY_CAP items).
 */
export async function updateMemory(
	npcName: string,
	existingMemory: string[],
	userText: string,
	npcReply: string,
): Promise<string[]> {
	const log = createLogger({ tool: "npc_memory" });
	const t = log.timer("update", { npcName, existing: existingMemory.length });

	const prompt =
		`以下是${npcName}与玩家的一次对话：\n` +
		`玩家：${userText}\n` +
		`${npcName}：${npcReply}\n\n` +
		`请从中提取1-3条值得记住的事实（不超过15字每条），以JSON数组形式返回，例如：["玩家喜欢冒险","曾提到有一把宝剑"]。只返回JSON，不要其他文字。`;

	let newFacts: string[] = [];
	try {
		const response = await completeSimple(haiku(), {
			systemPrompt: "你是记忆提取助手，从对话中提炼关键事实，只输出JSON数组。",
			messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
		});
		const raw = extractText(response);
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			newFacts = parsed.filter((x): x is string => typeof x === "string").slice(0, 3);
		}
	} catch {
		// Compression failed — don't update memory this round
		log.warn("extract facts failed", { npcName });
		return existingMemory;
	}

	const merged = [...existingMemory, ...newFacts];
	if (merged.length <= MEMORY_CAP) {
		t.end({ added: newFacts.length, total: merged.length });
		return merged;
	}

	// Cap exceeded: compress the oldest half down to a few summary lines
	const toCompress = merged.slice(0, Math.floor(MEMORY_CAP / 2));
	const keep = merged.slice(Math.floor(MEMORY_CAP / 2));
	try {
		const compressPrompt = `将以下记忆条目压缩成不超过5条最重要的事实，以JSON数组返回：\n${JSON.stringify(toCompress)}`;
		const r2 = await completeSimple(haiku(), {
			systemPrompt: "你是记忆压缩助手，只输出JSON数组。",
			messages: [{ role: "user", content: compressPrompt, timestamp: Date.now() }],
		});
		const compressed: unknown = JSON.parse(extractText(r2));
		if (Array.isArray(compressed)) {
			const compressedFacts = compressed.filter((x): x is string => typeof x === "string").slice(0, 5);
			t.end({ added: newFacts.length, compressed: true, total: compressedFacts.length + keep.length });
			return [...compressedFacts, ...keep];
		}
	} catch {
		// Compression failed — just truncate from the front
		log.warn("memory compression failed, truncating", { npcName });
	}
	t.end({ added: newFacts.length, truncated: true });
	return merged.slice(-MEMORY_CAP);
}
