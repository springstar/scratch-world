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

// Show a 2D HTML panel overlay in the center of the screen (follows the camera).
// Use ONLY for menus, info panels, dialogs. Pass null to dismiss.
world.setDisplay(html: string | null): void

// The Three.js scene graph — add meshes here to place objects in 3D world space.
// Objects added to world.scene stay fixed in the world, independent of camera movement.
// Use this for: TV screen overlays, signs, floating text, particles, lights, any 3D content.
//
// TV screen / sign / wall display — use this EXACT template for ANY physical surface content:
//   const canvas = document.createElement('canvas');
//   canvas.width = 1280; canvas.height = 720;
//   const ctx = canvas.getContext('2d');
//   ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 1280, 720);
//   ctx.fillStyle = '#fff'; ctx.font = 'bold 80px sans-serif';
//   ctx.textAlign = 'center'; ctx.fillText('Hello World', 640, 360);
//   const tex = new world.THREE.CanvasTexture(canvas);
//   const mesh = new world.THREE.Mesh(
//     new world.THREE.PlaneGeometry(DISPLAY_W, DISPLAY_H),
//     new world.THREE.MeshBasicMaterial({ map: tex, side: world.THREE.DoubleSide, depthTest: false, transparent: true })
//   );
//   // CRITICAL position rule: use objectPosition.x and objectPosition.z from Scene context,
//   // use displayY (also from Scene context) as the Y coordinate.
//   // Use displayWidth and displayHeight from Scene context for PlaneGeometry dimensions.
//   mesh.position.set(OBJ_X, DISPLAY_Y, OBJ_Z);
//   mesh.renderOrder = 1;   // REQUIRED: mesh transparent=true + renderOrder>0 renders on top of Gaussian Splat
//   world.scene.add(mesh);
//   // For animation: world.animate(() => { tex.needsUpdate = true; });
world.scene: THREE.Scene
world.camera: THREE.Camera  // read-only, for reference

// Access the full Three.js module via world.THREE — do NOT use a bare THREE global.
world.THREE: typeof import("three")
\`\`\`

Rules:
- Only use the \`world\` API. Do NOT access \`window\`, \`document\`, \`fetch\`, \`eval\`, or any global.
  Exception: \`document.createElement('canvas')\` is allowed when creating a CanvasTexture for world.scene.
- Do NOT use \`import\` or \`require\`.
- The script runs once. Use \`world.animate()\` for anything that needs to update every frame.
- Keep generated objects small and well-positioned so they're visible and don't block navigation.
- CRITICAL: For ANY content that should appear on a physical surface in the 3D world (TV, screen,
  sign, board, wall display) — always use world.scene + world.THREE mesh with renderOrder=1.
  NEVER use world.setDisplay() for 3D surface content.
- CRITICAL: For mesh position — ALWAYS use objectPosition.x and objectPosition.z from Scene context,
  and ALWAYS use displayY from Scene context as the Y coordinate. Never hardcode Y.
- CRITICAL: For PlaneGeometry — ALWAYS use displayWidth and displayHeight from Scene context. Never hardcode these values.
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
		// If calibrated code exists, use it directly — skip LLM call.
		if (ctx.config.autoRun && ctx.config.cachedCode) {
			const title = ctx.config.title ? String(ctx.config.title) : "代码生成";
			return { type: "script", code: String(ctx.config.cachedCode), title };
		}

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
			const posStr = ctx.objectPosition
				? `x=${ctx.objectPosition.x.toFixed(3)}, z=${ctx.objectPosition.z.toFixed(3)}`
				: "unknown";
			const displayY = (ctx.displayY ?? 1.3).toFixed(3);
			const displayW = ctx.displayWidth?.toFixed(3) ?? "1.600";
			const displayH = ctx.displayHeight?.toFixed(3) ?? "0.900";
			const response = await completeSimple(model, {
				systemPrompt: SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						content: `Scene context: objectName="${ctx.objectName}", sceneId="${ctx.sceneId}", objectPosition=(${posStr}), displayY=${displayY}, displayWidth=${displayW}, displayHeight=${displayH}\n\nUser request: ${userRequest}`,
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

		console.log(`[code-gen] generated code:\n${code}`);
		return { type: "script", code, title };
	},
};
