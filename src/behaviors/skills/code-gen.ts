import { completeSimple, getModel } from "@mariozechner/pi-ai";
import type {
	BehaviorContext,
	DisplayConfig,
	ResourceChoice,
	ResourceNeed,
	ResourceOption,
	SkillHandler,
} from "../types.js";

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

## Available particle textures

Load with \`new world.THREE.TextureLoader().load(path)\`. Always use \`depthWrite: false\` and \`blending: world.THREE.AdditiveBlending\` for fire/glow/explosion effects.

| path | description |
|------|-------------|
| \`/assets/particles/disc.png\` | Soft circle — dots, snow, rain, bubbles |
| \`/assets/particles/spark1.png\` | Star spark — fireworks, magic, welding |
| \`/assets/particles/snowflake1.png\` | Snowflake — snow, ice |
| \`/assets/particles/snowflake2.png\` | Alternate snowflake |
| \`/assets/particles/lensflare0.png\` | Large soft glow — explosion center, portal, sun |
| \`/assets/particles/lensflare3.png\` | Hexagonal flare — lens rings, bokeh |

Fireworks: spark1.png for burst particles + lensflare0.png for launch trail glow.
Snow/rain: disc.png or snowflake1.png.
Do NOT invent texture URLs — only use paths from this table.
`;

const RESOURCE_ANALYSIS_PROMPT = `You are a 3D effect resource analyst. Given a user request for a Three.js visual effect, determine if external texture resources would meaningfully improve the result compared to purely procedural generation.

Respond with JSON only, no explanation:
{
  "needsResources": boolean,
  "needs": [
    {
      "kind": "texture" | "model" | "audio" | "video",
      "label": "short description of what this resource is for",
      "suggested": { "id": "...", "name": "...", "url": "...", "source": "builtin" } | null,
      "options": [
        { "id": "...", "name": "...", "url": "...", "thumbnail": "...", "source": "builtin" }
      ]
    }
  ]
}

## Builtin particle textures (always prefer these over procedural for particle effects)

| id | name | url | best for |
|----|------|-----|----------|
| builtin_disc | Soft circle | /assets/particles/disc.png | snow, rain, bubbles, generic dots |
| builtin_spark | Star spark | /assets/particles/spark1.png | fireworks burst, magic, welding sparks |
| builtin_snowflake1 | Snowflake | /assets/particles/snowflake1.png | snow, ice |
| builtin_snowflake2 | Snowflake (alt) | /assets/particles/snowflake2.png | snow blizzard |
| builtin_glow | Large soft glow | /assets/particles/lensflare0.png | explosion center, portal, sun, fire core |
| builtin_flare | Hex flare | /assets/particles/lensflare3.png | lens rings, bokeh, secondary flares |

## Rules

- Set needsResources=true when: particle effects (fireworks, snow, fire, magic, sparkle, explosion), lens flare, glow effects.
- Set needsResources=false when: purely geometric animation (rotation, color pulse, bouncing boxes), text overlays, canvas drawings.
- For fireworks: suggest builtin_spark for burst particles; add builtin_glow as second need for launch trail.
- For snow: suggest builtin_disc or builtin_snowflake1.
- For fire/explosion: suggest builtin_glow as primary, builtin_spark as secondary.
- options array should include all relevant builtin options the user could choose from (usually 2-4).
- thumbnail = same as url for builtin textures.
`;

/** Builtin particle options for fast lookup when building resource-picker response */
const BUILTIN_PARTICLES: ResourceOption[] = [
	{
		id: "builtin_disc",
		name: "Soft circle",
		url: "/assets/particles/disc.png",
		thumbnail: "/assets/particles/disc.png",
		source: "builtin",
	},
	{
		id: "builtin_spark",
		name: "Star spark",
		url: "/assets/particles/spark1.png",
		thumbnail: "/assets/particles/spark1.png",
		source: "builtin",
	},
	{
		id: "builtin_snowflake1",
		name: "Snowflake",
		url: "/assets/particles/snowflake1.png",
		thumbnail: "/assets/particles/snowflake1.png",
		source: "builtin",
	},
	{
		id: "builtin_snowflake2",
		name: "Snowflake (alt)",
		url: "/assets/particles/snowflake2.png",
		thumbnail: "/assets/particles/snowflake2.png",
		source: "builtin",
	},
	{
		id: "builtin_glow",
		name: "Large soft glow",
		url: "/assets/particles/lensflare0.png",
		thumbnail: "/assets/particles/lensflare0.png",
		source: "builtin",
	},
	{
		id: "builtin_flare",
		name: "Hex flare",
		url: "/assets/particles/lensflare3.png",
		thumbnail: "/assets/particles/lensflare3.png",
		source: "builtin",
	},
];

function getModel_(modelId: string) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const m = getModel("anthropic", modelId as any);
	if (process.env.ANTHROPIC_BASE_URL) m.baseUrl = process.env.ANTHROPIC_BASE_URL;
	return m;
}

async function analyzeResources(
	userRequest: string,
	modelId: string,
): Promise<{ needsResources: boolean; needs: ResourceNeed[] }> {
	const model = getModel_(modelId);
	const response = await completeSimple(model, {
		systemPrompt: RESOURCE_ANALYSIS_PROMPT,
		messages: [{ role: "user", content: userRequest, timestamp: Date.now() }],
	});
	const raw = response.content
		.filter((c) => c.type === "text")
		.map((c) => (c as { type: "text"; text: string }).text)
		.join("")
		.trim()
		.replace(/^```[\w]*\n?/m, "")
		.replace(/\n?```$/m, "")
		.trim();

	try {
		const parsed = JSON.parse(raw) as { needsResources?: boolean; needs?: unknown[] };
		if (!parsed.needsResources || !Array.isArray(parsed.needs) || parsed.needs.length === 0) {
			return { needsResources: false, needs: [] };
		}
		// Validate and enrich options from BUILTIN_PARTICLES
		const needs: ResourceNeed[] = (parsed.needs as Array<Record<string, unknown>>).map((n) => {
			const options = Array.isArray(n.options)
				? (n.options as Array<Record<string, unknown>>).map((o) => {
						// Prefer data from BUILTIN_PARTICLES if id matches
						const builtin = BUILTIN_PARTICLES.find((b) => b.id === String(o.id ?? ""));
						return (
							builtin ?? {
								id: String(o.id ?? ""),
								name: String(o.name ?? ""),
								url: String(o.url ?? ""),
								thumbnail: o.thumbnail ? String(o.thumbnail) : undefined,
								source: (o.source as "builtin" | "cdn" | "upload") ?? "builtin",
							}
						);
					})
				: [];
			const suggestedRaw = n.suggested as Record<string, unknown> | null | undefined;
			const suggested = suggestedRaw
				? (BUILTIN_PARTICLES.find((b) => b.id === String(suggestedRaw.id ?? "")) ?? {
						id: String(suggestedRaw.id ?? ""),
						name: String(suggestedRaw.name ?? ""),
						url: String(suggestedRaw.url ?? ""),
						source: "builtin" as const,
					})
				: undefined;
			return {
				kind: (n.kind as ResourceNeed["kind"]) ?? "texture",
				label: String(n.label ?? ""),
				suggested,
				options,
			};
		});
		return { needsResources: true, needs };
	} catch {
		return { needsResources: false, needs: [] };
	}
}

function buildResourceContext(confirmedResources: ResourceChoice[]): string {
	if (confirmedResources.length === 0) return "";
	const lines = confirmedResources.map(
		(r) =>
			`- ${r.label}: use texture URL "${r.option.url}" (load with new world.THREE.TextureLoader().load("${r.option.url}"))`,
	);
	return `\n\n## User-selected resources (USE THESE — do not substitute)\n${lines.join("\n")}`;
}

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

		// ── Resource analysis phase ───────────────────────────────────────────
		// If user already confirmed resources, skip analysis and go straight to codegen.
		// If skipResourcePicker is set (user chose to skip), also go straight to codegen.
		const confirmedResources = Array.isArray(ctx.config.confirmedResources)
			? (ctx.config.confirmedResources as ResourceChoice[])
			: null;
		const skipResourcePicker = Boolean(ctx.config.skipResourcePicker);

		if (!confirmedResources && !skipResourcePicker) {
			try {
				const analysis = await analyzeResources(userRequest, modelId);
				if (analysis.needsResources && analysis.needs.length > 0) {
					return { type: "resource-picker", needs: analysis.needs, title };
				}
			} catch {
				// Analysis failure is non-fatal — fall through to codegen without resources
			}
		}

		// ── Code generation phase ─────────────────────────────────────────────
		const resourceContext = confirmedResources ? buildResourceContext(confirmedResources) : "";
		const model = getModel_(modelId);

		let code: string;
		try {
			const posStr = ctx.objectPosition
				? `x=${ctx.objectPosition.x.toFixed(3)}, z=${ctx.objectPosition.z.toFixed(3)}`
				: "unknown";
			const displayY = (ctx.displayY ?? 1.3).toFixed(3);
			const displayW = ctx.displayWidth?.toFixed(3) ?? "1.600";
			const displayH = ctx.displayHeight?.toFixed(3) ?? "0.900";
			const response = await completeSimple(model, {
				systemPrompt: SYSTEM_PROMPT + resourceContext,
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
