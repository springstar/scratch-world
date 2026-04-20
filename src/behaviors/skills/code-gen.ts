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

const SYSTEM_PROMPT = `You are a 3D world scripting expert. You generate high-quality, self-contained JavaScript that runs inside a live 3D scene via the WorldAPI sandbox.

${WORLD_API_DOCS}

---

## Execution process (follow every time)

Before writing any code, think through these steps in order:

**Step 1 — Classify the effect**
Identify which category this request falls into:
- PARTICLE: fireworks, snow, rain, fire, smoke, magic sparkle, explosion, confetti
- GEO_ANIM: rotating/floating/pulsing geometry, morphing shapes, wave effects
- LIGHT: dynamic lights, color-changing illumination, flickering
- UI_3D: text labels, signs, scoreboards, HUD elements attached to world space
- COMPOSITE: two or more of the above combined

**Step 2 — Apply the mandatory technique for that category**

PARTICLE effects — non-negotiable rules:
- ALWAYS use THREE.Points + THREE.BufferGeometry, never Mesh spheres as particles
- ALWAYS set depthWrite: false and blending: world.THREE.AdditiveBlending on the material
- ALWAYS set sizeAttenuation: true so particles scale with distance
- Minimum particle count: 200 for ambient effects, 500 for explosions/fireworks
- Particles MUST move: use world.animate() to update positions every frame
- For fireworks: implement ballistic trajectory (gravity = -9.8, initial velocity upward + spread)
- For fireworks: multi-burst pattern (launch 5-8 rockets at staggered intervals, each explodes)
- For snow/rain: wrap-around when particles fall below ground (reset to top)
- Texture: load from /assets/particles/ catalog, never procedural-only for particle shape

GEO_ANIM effects — rules:
- Use world.animate(dt) for all motion — never setInterval/setTimeout
- Accumulate time with a closure variable, not Date.now() (dt is already elapsed seconds)
- Smooth motion: use Math.sin/cos for oscillation, lerp for transitions
- Clean up: if effect is temporary, schedule removal via elapsed time check in animate()

LIGHT effects — rules:
- Use THREE.PointLight or THREE.SpotLight added to world.scene
- Always set light intensity and distance to reasonable values (intensity 1-5, distance 20-50)
- Animate intensity with Math.sin for flicker, not random() (random causes seizure-like strobing)

UI_3D effects — rules:
- Always use canvas + CanvasTexture + PlaneGeometry (see template in API docs)
- renderOrder = 1 on all UI meshes (renders above splat)
- depthTest = false on material (always visible, never occluded)
- Position using objectPosition.x/z and displayY from scene context

**Step 3 — Write the implementation**

Quality bar:
- Fireworks must have: launch phase (rocket rising with trail), explosion phase (burst of 200+ particles spreading in sphere), fade-out (opacity/size decay over 1-2 seconds)
- Snow must have: 500+ flakes, randomized sizes and speeds, continuous loop
- Effects must be immediately visible from default camera position (place near objectPosition)
- Code must be under 120 lines — extract helpers if needed, but no bloat

**Step 4 — Self-check before outputting**

Run through this checklist mentally:
- [ ] Particles use THREE.Points, not Mesh?
- [ ] AdditiveBlending and depthWrite: false set?
- [ ] world.animate() registered for moving elements?
- [ ] Effect positioned at objectPosition.x/z (not hardcoded 0,0)?
- [ ] Effect visible from ~5m distance (not too small, not too large)?
- [ ] No bare THREE global (always world.THREE)?
- [ ] No import/require/fetch/window/eval?

---

## Reference implementation: fireworks

This shows the correct pattern. Use it as a template when generating fireworks or similar burst effects.

\`\`\`javascript
// Fireworks — reference implementation (adapt as needed)
const THREE = world.THREE;
const OX = objectPosition.x, OZ = objectPosition.z;

const sparkTex = new THREE.TextureLoader().load('/assets/particles/spark1.png');
const glowTex  = new THREE.TextureLoader().load('/assets/particles/lensflare0.png');

const BURST_COUNT = 6;      // number of rockets
const PER_BURST   = 300;    // particles per explosion
const TOTAL       = BURST_COUNT * PER_BURST;

// Geometry — all bursts share one Points object for performance
const geo = new THREE.BufferGeometry();
const positions = new Float32Array(TOTAL * 3);
const velocities = new Float32Array(TOTAL * 3);
const lifetimes  = new Float32Array(TOTAL);   // remaining life in seconds
const maxLife    = new Float32Array(TOTAL);
const colors     = new Float32Array(TOTAL * 3);

geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));

const mat = new THREE.PointsMaterial({
  map: sparkTex, size: 0.35, sizeAttenuation: true,
  transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexColors: true,
});
const points = new THREE.Points(geo, mat);
points.renderOrder = 2;
world.scene.add(points);

// Burst palette
const palette = [
  [1.0, 0.3, 0.1], [1.0, 0.9, 0.1], [0.2, 0.6, 1.0],
  [1.0, 0.2, 0.8], [0.3, 1.0, 0.4], [1.0, 0.5, 0.0],
];

function spawnBurst(burstIdx, hue) {
  const base = burstIdx * PER_BURST;
  // Random launch origin above object
  const lx = OX + (Math.random() - 0.5) * 6;
  const lz = OZ + (Math.random() - 0.5) * 6;
  const peakY = 5 + Math.random() * 5;
  const col = palette[burstIdx % palette.length];
  for (let i = 0; i < PER_BURST; i++) {
    const idx = base + i;
    // Sphere spread
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const speed = 3 + Math.random() * 4;
    velocities[idx*3]   = Math.sin(phi) * Math.cos(theta) * speed;
    velocities[idx*3+1] = Math.cos(phi) * speed * 0.6 + 1;
    velocities[idx*3+2] = Math.sin(phi) * Math.sin(theta) * speed;
    positions[idx*3]   = lx;
    positions[idx*3+1] = peakY;
    positions[idx*3+2] = lz;
    const life = 1.2 + Math.random() * 0.8;
    lifetimes[idx] = life; maxLife[idx] = life;
    // Color with slight variation
    colors[idx*3]   = col[0] * (0.8 + Math.random() * 0.2);
    colors[idx*3+1] = col[1] * (0.8 + Math.random() * 0.2);
    colors[idx*3+2] = col[2] * (0.8 + Math.random() * 0.2);
  }
}

// Stagger burst launches
const launchTimes = Array.from({length: BURST_COUNT}, (_, i) => i * 0.8);
let elapsed = 0;
const launched = new Array(BURST_COUNT).fill(false);

world.animate((dt) => {
  elapsed += dt;
  // Launch rockets on schedule
  for (let b = 0; b < BURST_COUNT; b++) {
    if (!launched[b] && elapsed >= launchTimes[b]) {
      launched[b] = true;
      spawnBurst(b);
    }
  }
  // Integrate particle physics
  const gravity = -9.0;
  for (let i = 0; i < TOTAL; i++) {
    if (lifetimes[i] <= 0) { positions[i*3+1] = -9999; continue; }
    lifetimes[i] -= dt;
    velocities[i*3+1] += gravity * dt;
    positions[i*3]   += velocities[i*3]   * dt;
    positions[i*3+1] += velocities[i*3+1] * dt;
    positions[i*3+2] += velocities[i*3+2] * dt;
    // Fade to black as life expires
    const t = lifetimes[i] / maxLife[i];
    colors[i*3]   *= 0.97 + t * 0.02;
    colors[i*3+1] *= 0.97 + t * 0.02;
    colors[i*3+2] *= 0.97 + t * 0.02;
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate    = true;
  // Loop after last burst completes
  if (elapsed > launchTimes[BURST_COUNT-1] + 3.5) {
    elapsed = 0;
    launched.fill(false);
  }
});
\`\`\`

---

## Anti-patterns (never do these)

- Using \`new THREE.Mesh(new THREE.SphereGeometry(...), ...)\` for individual particles — O(N) draw calls, kills performance
- Hardcoding positions as (0, y, 0) — effect appears at scene origin, not near the prop
- Using \`Math.random()\` for light flicker — use \`Math.sin(elapsed * freq)\` instead
- Particle count < 100 — visually sparse, looks like a debug test
- No \`world.animate()\` call — effect is completely static
- Using bare \`THREE.\` — always \`world.THREE.\`
- Forgetting \`needsUpdate = true\` on BufferAttribute after modifying typed arrays

---

Output raw JavaScript only — no markdown fences, no comments explaining what you did, no preamble.`;

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
