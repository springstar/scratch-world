import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, Type } from "@mariozechner/pi-ai";
import { createLogger } from "../logger.js";
import type { SceneObject } from "../scene/types.js";
import type { RealtimeBus } from "../viewer-api/realtime.js";
import { buildPerceptionContext, extractSceneCaption } from "./npc-perception.js";
import { reactAsNpcNoCD } from "./npc-runner.js";
import { loadNpcSkills } from "./npc-skills.js";

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
	skillIds: string[];
	perceptionContext: string;
	userText: string;
	sceneObjects: SceneObject[];
	sessionId: string;
	sceneId: string;
	bus: RealtimeBus;
}): Promise<void> {
	const {
		npcId,
		npcName,
		personality,
		memory,
		skillIds,
		perceptionContext,
		userText,
		sceneObjects,
		sessionId,
		sceneId,
		bus,
	} = opts;

	const log = createLogger({ tool: "npc_agent", npc: npcId });
	const t = log.timer("agent_run", { npcName, userText: userText.slice(0, 60) });

	// Load skill prompt hints and tools
	const { promptAdditions, tools: skillTools } = loadNpcSkills(skillIds, { npcId, npcName, sessionId, sceneId, bus });
	const skillSection = promptAdditions.length > 0 ? `\n\n[已装备技能]\n${promptAdditions.join("\n")}` : "";

	const memorySection = memory.length > 0 ? `\n\n[你记得的事情]\n${memory.map((m) => `- ${m}`).join("\n")}` : "";
	const perceptionSection = perceptionContext ? `\n\n[当前感知]\n${perceptionContext}` : "";

	// Build skill tool list for system prompt description
	const skillToolNames = skillTools.map((t) => `- ${t.name}(...): ${t.description ?? t.label}`).join("\n");

	const systemPrompt =
		`你是${npcName}。${personality}${skillSection}${memorySection}${perceptionSection}\n\n` +
		`你可以使用以下工具来响应玩家：\n` +
		`- speak(text)：说出一句话\n` +
		`- observe_scene()：查看周围的场景对象（包含准确坐标）\n` +
		`- move_to(x, z)：移动到场景中某个位置（使用感知中的坐标）\n` +
		`- speak_to_npc(targetObjectId, text)：向附近的NPC说一句话并等待其回应\n` +
		`- emote(animation)：播放一个动作（idle/walk/talk/wave/bow）\n` +
		(skillToolNames ? `${skillToolNames}\n` : "") +
		`\n行为准则：\n` +
		`- 你了解场景中其他NPC的角色，可以主动和他们互动\n` +
		`- 如果玩家让你去找某人，先用move_to移动过去，再用speak_to_npc开口\n` +
		`- 至少调用一次 speak()。完成后停止。`;

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
		{
			name: "speak_to_npc",
			description: "向场景中另一个NPC说一句话，对方会自然回应",
			parameters: Type.Object({
				targetObjectId: Type.String({ description: "目标NPC的objectId（来自感知列表）" }),
				text: Type.String({ description: "你要对目标NPC说的话（1-2句）" }),
			}),
			label: "对话NPC",
			execute: async (_id, params) => {
				const { targetObjectId, text } = params as { targetObjectId: string; text: string };
				const targetNpc = sceneObjects.find((o) => o.objectId === targetObjectId && o.type === "npc");
				if (!targetNpc) return { content: [{ type: "text", text: "找不到该NPC" }], details: null };

				// Publish the initiating NPC's speech first
				bus.publish(sessionId, { type: "npc_speech", npcId, npcName, text, sceneId });

				// Build fresh perception context for the target NPC
				const env = sceneObjects.find((o) => o.type === "terrain")?.metadata ?? {};
				const targetPerception = buildPerceptionContext(
					targetNpc,
					sceneObjects,
					undefined,
					env as { timeOfDay?: string; weather?: string },
					extractSceneCaption(sceneObjects),
				);
				const targetPersonality = (targetNpc.metadata?.npcPersonality as string | undefined) ?? "一个普通的村民";
				const targetMemory: string[] = (() => {
					const raw = targetNpc.metadata?.npcMemory;
					if (!Array.isArray(raw)) return [];
					return raw.filter((x): x is string => typeof x === "string");
				})();

				// Generate the target NPC's reaction (bypasses cooldown — NPC-to-NPC)
				const context = `${npcName}对你说："${text}"`;
				const reply = await reactAsNpcNoCD(
					targetNpc.objectId,
					targetNpc.name,
					targetPersonality,
					context,
					targetMemory,
					targetPerception,
				);
				if (reply) {
					bus.publish(sessionId, {
						type: "npc_speech",
						npcId: targetNpc.objectId,
						npcName: targetNpc.name,
						text: reply,
						sceneId,
					});
				}
				return {
					content: [
						{ type: "text", text: reply ? `${targetNpc.name} 回应："${reply}"` : `${targetNpc.name} 没有回应` },
					],
					details: null,
				};
			},
		},
	];

	// Merge skill tools
	const allTools = [...tools, ...skillTools];

	const agent = new Agent({
		convertToLlm: (messages) =>
			messages.filter(
				(m): m is Extract<typeof m, { role: "user" | "assistant" }> =>
					"role" in m && (m.role === "user" || m.role === "assistant" || m.role === "toolResult"),
			),
	});

	agent.setModel(haiku());
	agent.setSystemPrompt(systemPrompt);
	agent.setTools(allTools);

	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), AGENT_TIMEOUT_MS);

	try {
		await Promise.race([
			agent.prompt(userText),
			new Promise<void>((_, reject) =>
				abort.signal.addEventListener("abort", () => reject(new Error("NPC agent timeout"))),
			),
		]);
		t.end({ outcome: "done" });
	} catch (err) {
		if ((err as Error).message !== "NPC agent timeout") throw err;
		log.warn("agent timed out", { npcName, timeoutMs: AGENT_TIMEOUT_MS });
	} finally {
		clearTimeout(timer);
	}
}
