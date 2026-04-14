import { completeSimple, getModel } from "@mariozechner/pi-ai";
import type { BehaviorContext, DisplayConfig, SkillHandler } from "../types.js";

/** WorldAPI surface documented for the LLM — must match viewer/src/behaviors/world-api.ts */
const WORLD_API_DOCS = `\
You have access to a \`world\` object with the following API:

\`\`\`
// Spawn a primitive object in the scene. Returns a string objectId.
world.spawn(opts: {
  shape: "box" | "sphere" | "cylinder" | "plane",
  x: number, y: number, z: number,     // world position
  width?: number, height?: number, depth?: number,  // for box/plane
  radius?: number,                                  // for sphere/cylinder
  color?: string,   // CSS color string e.g. "#ff0000" or "red"
  opacity?: number, // 0–1, default 1
  name?: string,    // optional label
}): string

// Remove a previously spawned object.
world.despawn(objectId: string): void

// Change the color of a spawned object.
world.setColor(objectId: string, color: string): void

// Register a per-frame callback. dt = elapsed seconds since last frame.
// Keep callbacks cheap — they run every ~16 ms.
world.animate(cb: (dt: number) => void): void

// Show a temporary HUD toast message.
world.showToast(text: string, durationMs?: number): void

// Show an HTML panel in the center of the screen. Pass null to dismiss.
// Use for text, formatted content, welcome messages, info panels, etc.
// Supports any HTML tags: <h2>, <p>, <ul>, <b>, <span style="color:..."> etc.
world.setDisplay(html: string | null): void

// Current scene provider type.
world.provider: "splat" | "threejs"

// THREE.js objects — use for advanced manipulation.
// NOTE: world.scene and world.camera are only available when provider === "threejs"
// or when you need to add custom Three.js objects alongside a splat.
world.scene: THREE.Scene
world.camera: THREE.Camera
\`\`\`

Rules:
- Only use the \`world\` API. Do NOT access \`window\`, \`document\`, \`fetch\`, \`eval\`, or any global.
- Do NOT use \`import\` or \`require\`.
- The script runs once. Use \`world.animate()\` for anything that needs to update every frame.
- Keep generated objects small and well-positioned so they're visible and don't block navigation.
- Return only the raw JavaScript — no markdown fences, no explanation.
`;

const SYSTEM_PROMPT = `You are a 3D world scripting assistant. You generate short, self-contained JavaScript snippets that run inside an open 3D world using the provided WorldAPI.

${WORLD_API_DOCS}

When given a user request, generate ONLY the JavaScript code that fulfills it. Output raw JS — no explanation, no markdown fences.`;

export const codeGenSkill: SkillHandler = {
	name: "code-gen",
	description:
		"Generates and executes a custom JavaScript behavior using the WorldAPI sandbox. Use when no built-in skill covers the user's request.",
	configSchema: {
		prompt: {
			description:
				"Natural language description of the desired behavior, e.g. 'make the object slowly rotate and pulse its color between red and blue'.",
			required: true,
		},
		title: { description: "Optional label shown in the activation button.", required: false },
		mode: {
			description:
				"'preset' (default) — run the preset prompt when player interacts. 'interactive' — show a text input so the player can type their own request.",
			required: false,
		},
		model: {
			description:
				"Anthropic model ID for code generation (default: claude-sonnet-4-6). Use claude-haiku-4-5-20251001 for faster/cheaper responses.",
			required: false,
		},
	},
	async handle(ctx: BehaviorContext): Promise<DisplayConfig> {
		// Support interactive mode: player provides the request at runtime via interactionData.
		const userRequest = ctx.config.userRequest
			? String(ctx.config.userRequest)
			: ctx.config.prompt
				? String(ctx.config.prompt)
				: null;

		if (!userRequest) {
			return {
				type: "markdown",
				content: "**配置错误:** code-gen skill 缺少 `prompt` 字段。",
				title: "错误",
			};
		}

		const title = ctx.config.title ? String(ctx.config.title) : "代码生成";

		const modelId = ctx.config.model ? String(ctx.config.model) : "claude-sonnet-4-6";
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const model = getModel("anthropic", modelId as any);
		if (process.env.ANTHROPIC_BASE_URL) model.baseUrl = process.env.ANTHROPIC_BASE_URL;

		let code: string;
		try {
			const response = await completeSimple(model, {
				systemPrompt: SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						content: `Scene context: objectName="${ctx.objectName}", sceneId="${ctx.sceneId}"\n\nUser request: ${userRequest}`,
						timestamp: Date.now(),
					},
				],
			});
			code = response.content
				.filter((c) => c.type === "text")
				.map((c) => (c as { type: "text"; text: string }).text)
				.join("")
				.trim();
			// Strip any accidental markdown fences the model might add.
			code = code
				.replace(/^```[\w]*\n?/m, "")
				.replace(/\n?```$/m, "")
				.trim();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				type: "markdown",
				content: `**代码生成失败:** ${msg}`,
				title: "错误",
			};
		}

		return { type: "script", code, title };
	},
};
