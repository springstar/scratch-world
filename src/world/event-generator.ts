import { completeSimple, getModel } from "@mariozechner/pi-ai";
import { randomUUID } from "crypto";
import type { Scene } from "../scene/types.js";
import type { WorldEvent } from "../storage/types.js";

const EVENT_TIMEOUT_MS = 8_000;

const EVENT_TYPES = ["weather", "discovery", "npc_activity", "anomaly"] as const;
type EventType = (typeof EVENT_TYPES)[number];

function haiku() {
	const model = getModel("anthropic", "claude-haiku-4-5-20251001");
	if (process.env.ANTHROPIC_BASE_URL) model.baseUrl = process.env.ANTHROPIC_BASE_URL;
	return model;
}

function worldTimeToString(t: number): string {
	const h = Math.floor(t / 3600) % 24;
	const m = Math.floor((t % 3600) / 60);
	if (h < 6 || h >= 22) return `深夜 ${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
	if (h < 10) return `清晨 ${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
	if (h < 14) return `上午 ${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
	if (h < 18) return `下午 ${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
	return `傍晚 ${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Generate a single world event for a living scene using Claude Haiku.
 * Returns null on any failure (network, parse error, timeout) so the heartbeat
 * can silently skip event generation without affecting worldTime updates.
 *
 * Also returns an updatedNarrative (100-200 chars) for the heartbeat to persist
 * so the next event generation has a running story arc as context.
 */
export async function generateWorldEvent(
	scene: Scene,
	recentEvents: WorldEvent[],
): Promise<(Omit<WorldEvent, "eventId" | "sceneId" | "createdAt"> & { updatedNarrative?: string }) | null> {
	const worldTime = scene.sceneData.environment.worldTime ?? 43200;
	const timeStr = worldTimeToString(worldTime);
	const npcNames = scene.sceneData.objects
		.filter((o) => o.type === "npc")
		.map((o) => o.name)
		.slice(0, 5)
		.join(", ");
	const recentHeadlines =
		recentEvents.length > 0
			? `\n\n最近发生的事件（请避免重复）：\n${recentEvents
					.slice(0, 3)
					.map((e) => `- ${e.headline}`)
					.join("\n")}`
			: "";
	const narrativeContext = scene.sceneData.environment.worldNarrative
		? `\n\n世界叙事背景（延续此故事弧）：${scene.sceneData.environment.worldNarrative}`
		: "";

	const prompt = `你是一个奇幻世界的编年史作者。请为以下世界生成一个简短的世界事件。

世界名称：${scene.title}
世界描述：${scene.description}
当前时间：${timeStr}${npcNames ? `\n已知居民：${npcNames}` : ""}${narrativeContext}${recentHeadlines}

请生成一个发生在此时此刻的世界事件，必须是以下类型之一：
- weather（天气变化）
- discovery（新发现或秘密）
- npc_activity（居民活动）
- anomaly（神秘异象）

同时，将已有叙事背景与此次事件合并，生成一段更新后的世界叙事摘要（不超过100字，整合历史与新事件，形成连贯故事弧）。

请严格按照以下JSON格式回复（不要有其他文字）：
{
  "eventType": "weather|discovery|npc_activity|anomaly",
  "headline": "不超过30字的标题",
  "body": "1-2句话的描述，富有画面感",
  "narrative": "不超过100字的世界叙事摘要"
}`;

	try {
		const timer = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error("event generation timeout")), EVENT_TIMEOUT_MS),
		);

		const result = await Promise.race([
			completeSimple(haiku(), {
				messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			}),
			timer,
		]);

		const text = (result as Awaited<ReturnType<typeof completeSimple>>).content
			.filter((c) => c.type === "text")
			.map((c) => (c as { type: "text"; text: string }).text)
			.join("")
			.trim();

		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) return null;

		const parsed = JSON.parse(jsonMatch[0]) as {
			eventType?: string;
			headline?: string;
			body?: string;
			narrative?: string;
		};
		if (!parsed.headline || !parsed.body) return null;
		const eventType = EVENT_TYPES.includes(parsed.eventType as EventType)
			? (parsed.eventType as EventType)
			: "anomaly";

		return {
			worldTime,
			eventType,
			headline: String(parsed.headline).slice(0, 60),
			body: String(parsed.body),
			...(parsed.narrative ? { updatedNarrative: String(parsed.narrative).slice(0, 200) } : {}),
		};
	} catch (err) {
		console.error("[event-generator] failed:", err instanceof Error ? err.message : err);
		return null;
	}
}

export function makeWorldEventId(): string {
	return randomUUID();
}
