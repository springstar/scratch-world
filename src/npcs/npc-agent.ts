import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, Type } from "@mariozechner/pi-ai";
import type { SceneObject } from "../scene/types.js";
import type { RealtimeBus } from "../viewer-api/realtime.js";

const AGENT_TIMEOUT_MS = 15_000;

function haiku() {
	const model = getModel("anthropic", "claude-haiku-4-5-20251001");
	if (process.env.ANTHROPIC_BASE_URL) model.baseUrl = process.env.ANTHROPIC_BASE_URL;
	return model;
}

/**
 * Run a single NPC interaction through a tool-use agent loop.
 * The NPC can speak, observe the scene, move, or play an emote.
 * Returns when the agent stops (end_turn) or the timeout fires.
 */
export async function runNpcAgent(opts: {
	npcId: string;
	npcName: string;
	personality: string;
	memory: string[];
	perceptionContext: string;
	userText: string;
	sceneObjects: SceneObject[];
	sessionId: string;
	sceneId: string;
	bus: RealtimeBus;
}): Promise<void> {
	const { npcId, npcName, personality, memory, perceptionContext, userText, sceneObjects, sessionId, sceneId, bus } =
		opts;

	const memorySection = memory.length > 0 ? `\n\n[你记得的事情]\n${memory.map((m) => `- ${m}`).join("\n")}` : "";
	const perceptionSection = perceptionContext ? `\n\n[当前感知]\n${perceptionContext}` : "";

	const systemPrompt =
		`你是${npcName}。${personality}${memorySection}${perceptionSection}\n\n` +
		`你可以使用以下工具来响应玩家：\n` +
		`- speak(text)：说出一句话\n` +
		`- observe_scene()：查看周围的场景对象\n` +
		`- move_to(x, z)：移动到场景中某个位置\n` +
		`- emote(animation)：播放一个动作（idle/walk/talk/wave/bow）\n\n` +
		`始终以符合角色的方式行动。至少调用一次 speak()。完成后停止。`;

	const tools: AgentTool[] = [
		{
			name: "speak",
			description: "说出一段话，发布到对话气泡",
			parameters: Type.Object({
				text: Type.String({ description: "要说的内容（1-2句）" }),
			}),
			label: "说话",
			execute: async (_id, params) => {
				const { text } = params as { text: string };
				bus.publish(sessionId, { type: "npc_speech", npcId, npcName, text, sceneId });
				return { content: [{ type: "text", text: "已说出" }], details: null };
			},
		},
		{
			name: "observe_scene",
			description: "查看当前场景中的对象列表",
			parameters: Type.Object({}),
			label: "观察场景",
			execute: async () => {
				const visible = sceneObjects
					.filter((o) => o.type !== "terrain" && o.type !== "floor" && o.type !== "sky")
					.slice(0, 10)
					.map((o) => `${o.name}（${o.type}，位置 ${o.position.x.toFixed(1)},${o.position.z.toFixed(1)}）`)
					.join("\n");
				const result = visible || "场景中没有可见对象";
				return { content: [{ type: "text", text: result }], details: result };
			},
		},
		{
			name: "move_to",
			description: "移动到场景中指定的世界坐标（X, Z平面）",
			parameters: Type.Object({
				x: Type.Number({ description: "目标X坐标" }),
				z: Type.Number({ description: "目标Z坐标" }),
			}),
			label: "移动",
			execute: async (_id, params) => {
				const { x, z } = params as { x: number; z: number };
				bus.publish(sessionId, { type: "npc_move", npcId, position: { x, y: 0, z }, sceneId });
				return {
					content: [{ type: "text", text: `正在移动到 (${x.toFixed(1)}, ${z.toFixed(1)})` }],
					details: null,
				};
			},
		},
		{
			name: "emote",
			description: "播放一个动作动画",
			parameters: Type.Object({
				animation: Type.String({ description: "动作名称: idle / walk / talk / wave / bow" }),
			}),
			label: "动作",
			execute: async (_id, params) => {
				const { animation } = params as { animation: string };
				bus.publish(sessionId, { type: "npc_emote", npcId, animation, sceneId });
				return { content: [{ type: "text", text: `播放动作: ${animation}` }], details: null };
			},
		},
	];

	const agent = new Agent({
		convertToLlm: (messages) =>
			messages.filter(
				(m): m is Extract<typeof m, { role: "user" | "assistant" }> =>
					"role" in m && (m.role === "user" || m.role === "assistant" || m.role === "toolResult"),
			),
	});

	agent.setModel(haiku());
	agent.setSystemPrompt(systemPrompt);
	agent.setTools(tools);

	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), AGENT_TIMEOUT_MS);

	try {
		await Promise.race([
			agent.prompt(userText),
			new Promise<void>((_, reject) =>
				abort.signal.addEventListener("abort", () => reject(new Error("NPC agent timeout"))),
			),
		]);
	} catch (err) {
		if ((err as Error).message !== "NPC agent timeout") throw err;
	} finally {
		clearTimeout(timer);
	}
}
