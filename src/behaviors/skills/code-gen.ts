import { completeSimple, getModel } from "@mariozechner/pi-ai";
import type {
	BehaviorContext,
	DisplayConfig,
	ResourceChoice,
	ResourceNeed,
	ResourceOption,
	SkillHandler,
} from "../types.js";
import { detectCategoryFromRequest, detectCodeCategory } from "./categories/index.js";
import { detectEffect } from "./effects/index.js";

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

// Spark 2.0 Gaussian Splat rendering — only available when world.provider === "splat".
// Always guard with: if (world.spark) { ... }
world.spark: {
  // Add a SDF-based edit to the scene splat (deformation, colorization, displacement).
  // Edits are applied in GPU shader — zero Three.js draw call cost.
  addEdit(edit): void
  removeEdit(edit): void

  // Add a Spark SplatMesh (e.g. snowBox result) to the scene.
  // Returns cleanup function: const cleanup = world.spark.addSplat(snow); world.animate(() => { if (done) cleanup(); });
  addSplat(mesh): () => void

  // Runtime depth-of-field on the scene splat.
  // focalDistance: world-space distance from camera (e.g. 5.0 = focus 5m ahead)
  // apertureAngle: 0 = off, 0.01 = subtle, 0.05 = cinematic, 0.15 = extreme
  setDof(focalDistance: number, apertureAngle: number): void

  // Constructor classes — use to build edits and generators:
  Spark: {
    // SDF edit container — attach SDFs to define the affected region
    SplatEdit: class  // new world.spark.Spark.SplatEdit({ rgbaBlendMode, sdfSmooth, softEdge })
    // Individual SDF shape within an edit
    SplatEditSdf: class  // new world.spark.Spark.SplatEditSdf({ type, radius, opacity, color, displace })
    // SDF type enum: "sphere" | "box" | "plane" | "ellipsoid" | "cylinder" | "capsule" | "infinite_cone"
    SplatEditSdfType: { SPHERE, BOX, PLANE, ELLIPSOID, CYLINDER, CAPSULE, INFINITE_CONE }
    // Blend mode: "multiply" (darken/fade) | "set_rgb" (recolor) | "add_rgba" (additive glow)
    SplatEditRgbaBlendMode: { MULTIPLY, SET_RGB, ADD_RGBA }

    // Built-in Gaussian snow/rain particle system (rendered as splats, not Three.js Points)
    // Returns { snow: SplatMesh, fallVelocity, opacity, color1, color2, ... } — live DynoFloat params
    snowBox(opts: { box?, density?, fallVelocity?, color1?, color2?, opacity?, anisoScale?, minScale?, maxScale? }): { snow, fallVelocity, opacity, ... }

    // Convert image URL to splat cloud
    imageSplats(opts: { url: string, dotRadius?, subXY?, forEachSplat? }): SplatMesh
    // Render text as splat cloud
    textSplats(opts: { text: string, fontSize?, color?, textAlign?, objectScale? }): SplatMesh
  }
}
\`\`\`

Rules:
- Only use the \`world\` API. Do NOT access \`window\`, \`document\`, \`fetch\`, \`eval\`, or any global.
  Exception: \`document.createElement('canvas')\` is allowed when creating a CanvasTexture for world.scene.
- Do NOT use \`import\` or \`require\`.
- CRITICAL: \`world\` exposes DIRECT PROPERTIES only — \`world.scene\`, \`world.camera\`, \`world.THREE\`, \`world.spark\`.
  There are NO getter methods. \`world.getThreeScene()\`, \`world.getScene()\`, \`world.getRenderer()\`, \`world.getCamera()\` do NOT exist and will throw.
- CRITICAL: The ONLY world methods are: \`world.spawn()\`, \`world.despawn()\`, \`world.setColor()\`, \`world.animate()\`, \`world.showToast()\`, \`world.setDisplay()\`.
  There is NO \`world.showPanel()\`, \`world.openPanel()\`, \`world.showPopup()\`, \`world.createPanel()\` — these do not exist and will throw.
  To show a 2D HTML overlay, use \`world.setDisplay(htmlString)\`. To dismiss it, call \`world.setDisplay(null)\`.
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

const DESIGN_PROMPT = `You are a 3D effects technical designer. Given a user request for a visual effect in a Three.js scene, produce a concise technical design document that a code generator will use as a blueprint.

Output a JSON object with this structure:
{
  "category": "PARTICLE" | "GEO_ANIM" | "LIGHT" | "UI_3D" | "COMPOSITE",
  "summary": "one sentence description of the effect",
  "phases": [
    { "name": "phase name", "duration_s": number | null, "description": "what happens" }
  ],
  "particles": {
    "systems": number,
    "count_per_system": number,
    "texture": "spark1 | snowflake1 | snowflake2 | lensflare0 | lensflare3 | disc",
    "blending": "AdditiveBlending | NormalBlending",
    "size_range": [min, max],
    "lifetime_range_s": [min, max],
    "initial_velocity": "description e.g. upward vy=14-20, sphere spread spd=4-9",
    "gravity": number,
    "color_palette": ["#rrggbb", ...]
  } | null,
  "geometry": {
    "shapes": ["box|sphere|cylinder|plane"],
    "animation": "description of transform animation"
  } | null,
  "lights": {
    "types": ["PointLight|SpotLight"],
    "intensity_range": [min, max],
    "animation": "description"
  } | null,
  "key_constraints": ["list of must-have implementation details"],
  "common_mistakes": ["list of mistakes to avoid for this specific effect"]
}

Rules:
- Be specific with numbers (velocities, counts, durations) — the code generator will use them directly
- For fireworks: phases must be [rocket_ascent, explosion, fade]. rocket_ascent vy must be 14-20 units/s. explosion spawns all burst particles at rocket peak position.
- For snow: count ≥ 500, wrap-around when y < ground, continuous loop
- common_mistakes must be specific to this effect, not generic
- Output only the JSON, no prose`;

async function designEffect(userRequest: string): Promise<string> {
	const model = getModel_("claude-haiku-4-5-20251001");
	try {
		const response = await completeSimple(model, {
			systemPrompt: DESIGN_PROMPT,
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
		// Validate it's parseable JSON — if not, return empty string (non-fatal)
		JSON.parse(raw);
		return raw;
	} catch {
		return "";
	}
}

function reviewGeneratedCode(code: string, userRequest: string): string[] {
	const violations: string[] = [];
	const categoryDef = detectCodeCategory(code);

	// Universal rules
	if (/\bTHREE\./.test(code)) violations.push("Uses bare THREE global — must use world.THREE");
	if (/\b(import|require)\b/.test(code)) violations.push("Contains import/require — not allowed in sandbox");
	if (/\b(window|fetch|eval)\b/.test(code)) violations.push("Uses window/fetch/eval — not allowed in sandbox");
	if (!categoryDef?.skipAnimateCheck && !/world\.animate\s*\(/.test(code)) {
		violations.push("No world.animate() call — effect will be completely static");
	}
	const hallucinated = code.match(/world\.(get\w+|getScene|getThreeScene|getRenderer|getCamera|getControls)\s*\(/g);
	if (hallucinated) {
		violations.push(
			`world has no getter methods — use direct properties: world.scene, world.camera, world.THREE. Hallucinated: ${[...new Set(hallucinated)].join(", ")}`,
		);
	}
	const hallucinatedMethods = code.match(
		/world\.(showPanel|openPanel|showPopup|createPanel|showDialog|openDialog|showWindow|openWindow|addPanel|showUI)\s*\(/g,
	);
	if (hallucinatedMethods) {
		violations.push(
			`world has no panel/popup methods — use world.setDisplay(html) for 2D overlay or world.scene for 3D. Hallucinated: ${[...new Set(hallucinatedMethods)].join(", ")}`,
		);
	}

	// Category-specific invariants from registry (detected from generated code, not user request)
	for (const invariant of categoryDef?.invariants ?? []) {
		if (invariant.test(code)) violations.push(invariant.message);
	}

	// Effect-specific invariants from registry (keyed on user request keywords)
	const effectDef = detectEffect(userRequest);
	if (effectDef) {
		for (const invariant of effectDef.invariants) {
			if (invariant.test(code)) violations.push(invariant.message);
		}
	}

	return violations;
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
- SPLAT_EDIT: spatial deformation of the scene background (ripple, shockwave, warp, burn, color zone)
- SPLAT_WEATHER: snow/rain/fog as high-quality Gaussian splat particles (prefer over THREE.Points for weather)
- COMPOSITE: two or more of the above combined

**Step 2 — Apply the mandatory technique for that category**

PARTICLE effects — non-negotiable rules:
- ALWAYS use THREE.Points + THREE.BufferGeometry, never Mesh spheres as particles
- ALWAYS set depthWrite: false AND depthTest: false on the material — Gaussian Splat depth buffer occludes particles even at higher renderOrder unless depthTest is explicitly disabled
- ALWAYS set sizeAttenuation: true so particles scale with distance
- ALWAYS set .frustumCulled = false on every THREE.Points object — particles initialized at y=-9999 (off-screen park) bake a bounding sphere at that position; Three.js frustum culling then permanently rejects the geometry even after positions update to valid world coordinates
- Minimum particle count: 200 for ambient effects, 500 for explosions/fireworks
- Particles MUST move: use world.animate() to update positions every frame
- For fireworks: TWO separate particle systems — (1) rocket streaks rising fast (vy ≥ 14 units/s, ascent ~0.5s), then (2) explosion burst (200+ particles from peak in sphere spread). Never place burst particles at peak directly — they must be spawned by the rocket reaching peak height.
- For fireworks: multi-burst pattern (launch 5-8 rockets at staggered intervals, each explodes)
- For fireworks: MUST use vivid vertex colors from a palette (red, gold, blue, magenta, green, orange) — white-only particles are invisible in bright daylit scenes. Use vertexColors: true on material and set bCol[] per particle.
- For snow/rain: consider SPLAT_WEATHER instead — higher quality, lower CPU cost
- Texture: load from /assets/particles/ catalog, never procedural-only for particle shape

SPLAT_EDIT effects — use when deforming or colorizing the 3D scene background itself:
\`\`\`javascript
// Pattern: create SplatEdit with one or more SplatEditSdf shapes
if (world.spark) {
  const { SplatEdit, SplatEditSdf, SplatEditSdfType, SplatEditRgbaBlendMode } = world.spark.Spark;
  const edit = new SplatEdit({ rgbaBlendMode: SplatEditRgbaBlendMode.SET_RGB, softEdge: 0.3 });
  const sdf = new SplatEditSdf({ type: SplatEditSdfType.SPHERE, radius: 3.0, opacity: 0.8, color: new world.THREE.Color(1, 0.3, 0.1) });
  edit.position.set(objectPosition.x, objectPosition.y + 1, objectPosition.z);
  world.spark.addEdit(edit);
  edit.addSdf(sdf);
  // Animate: edit.position.y += dt * 2 etc., or edit.sdfs[0].radius changes
  world.animate((dt) => { /* update edit.position or sdf properties */ });
}
\`\`\`

SPLAT_WEATHER effects — use world.spark.Spark.snowBox for snow/rain:
\`\`\`javascript
if (world.spark) {
  const THREE = world.THREE;
  const { snowBox } = world.spark.Spark;
  const result = snowBox({
    box: new THREE.Box3(
      new THREE.Vector3(objectPosition.x - 15, objectPosition.y, objectPosition.z - 15),
      new THREE.Vector3(objectPosition.x + 15, objectPosition.y + 20, objectPosition.z + 15)
    ),
    density: 0.003,
    fallVelocity: 1.5,    // slow for snow, 8+ for rain
    color1: new THREE.Color(0.9, 0.95, 1.0),
    color2: new THREE.Color(0.8, 0.85, 0.95),
    opacity: 0.7,
  });
  const cleanup = world.spark.addSplat(result.snow);
  // Cleanup when done: cleanup()
}
\`\`\`

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
- Fireworks must have: rocket phase (streak rising fast from ground, vy ≥ 14, ascent time ~0.5-0.7s), explosion phase (burst of 200+ particles spreading in sphere from peak position), fade-out (opacity/color decay + gravity over 1-2 seconds). Must NOT skip the rocket phase — a firework that just places particles at the peak is wrong.
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

{{EFFECT_REFERENCE}}
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

		// Scene environment — declared early, used by fast path and LLM path
		const env = ctx.environment ?? {};

		// Fast path: reference implementations always bypass cachedCode — they are deterministic
		// and must reflect the latest referenceImpl/adaptImpl (cachedCode may be stale).
		const effectDefEarly = detectEffect(userRequest);
		if (effectDefEarly?.useReferenceDirectly) {
			const code = effectDefEarly.adaptImpl
				? effectDefEarly.adaptImpl(effectDefEarly.referenceImpl, env)
				: effectDefEarly.referenceImpl;
			console.log(
				`[code-gen] reference impl (${effectDefEarly.keywords}, env: timeOfDay=${env.timeOfDay ?? "unknown"}, skybox=${env.skybox ?? "unknown"}):\n${code}`,
			);
			return { type: "script", code, title };
		}

		// If calibrated LLM code exists, use it directly — skip LLM call.
		// autoRun controls when the script fires (on approach vs manual E), not whether to cache.
		if (ctx.config.cachedCode) {
			console.log(`[code-gen] serving cachedCode for "${userRequest}"`);
			return { type: "script", code: String(ctx.config.cachedCode), title };
		}

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

		// ── Design pass (Pass 1) ──────────────────────────────────────────────
		// Run a lightweight design LLM call to produce a structured blueprint.
		// The blueprint is injected into the codegen prompt as additional context.
		const designDoc = await designEffect(userRequest);
		const designContext = designDoc
			? `\n\n## Effect design blueprint (follow this exactly)\n\`\`\`json\n${designDoc}\n\`\`\``
			: "";
		if (designDoc) {
			console.log(`[code-gen] design pass:\n${designDoc}`);
		}

		// ── Code generation phase (Pass 2) ────────────────────────────────────
		const resourceContext = confirmedResources ? buildResourceContext(confirmedResources) : "";
		const model = getModel_(modelId);

		// Inject effect-specific reference implementation into system prompt
		const effectDef = detectEffect(userRequest);

		const effectReference = effectDef
			? `## Effect reference: ${effectDef.keywords.source ?? "matched effect"}\n\n${effectDef.designIntent}\n\n\`\`\`javascript\n${effectDef.referenceImpl}\n\`\`\``
			: "";

		// Scene hints from category registry — injected into system prompt for scene-aware generation
		const categoryDef = detectCategoryFromRequest(userRequest);
		const hints = categoryDef?.sceneHints(env) ?? [];
		const sceneHintsSection =
			hints.length > 0
				? `\n\n## Scene adaptation rules (MUST follow for this scene)\n${hints.map((h) => `- ${h}`).join("\n")}`
				: "";

		// Platform capability hints — inform LLM of available platform APIs that can enhance this category
		const platformHints = categoryDef?.platformHints?.() ?? [];
		const platformHintsSection =
			platformHints.length > 0
				? `\n\n## Platform enhancement opportunities (evaluate and use where appropriate)\n${platformHints.map((h) => `- ${h}`).join("\n")}`
				: "";

		const systemPrompt =
			SYSTEM_PROMPT.replace("{{EFFECT_REFERENCE}}", effectReference) +
			sceneHintsSection +
			platformHintsSection +
			resourceContext;

		// Extract design constraints for retry feedback — no extra LLM call needed
		let designConstraints = "";
		if (designDoc) {
			try {
				const parsed = JSON.parse(designDoc) as {
					key_constraints?: string[];
					common_mistakes?: string[];
				};
				const parts: string[] = [];
				if (parsed.key_constraints?.length) {
					parts.push(`Key constraints:\n${parsed.key_constraints.map((c) => `- ${c}`).join("\n")}`);
				}
				if (parsed.common_mistakes?.length) {
					parts.push(`Common mistakes to avoid:\n${parsed.common_mistakes.map((m) => `- ${m}`).join("\n")}`);
				}
				if (parts.length)
					designConstraints = `\n\n## Design constraints (from effect blueprint)\n${parts.join("\n\n")}`;
			} catch {
				// non-fatal
			}
		}

		const posStr = ctx.objectPosition
			? `x=${ctx.objectPosition.x.toFixed(3)}, z=${ctx.objectPosition.z.toFixed(3)}`
			: "unknown";
		const displayY = (ctx.displayY ?? 1.3).toFixed(3);
		const displayW = ctx.displayWidth?.toFixed(3) ?? "1.600";
		const displayH = ctx.displayHeight?.toFixed(3) ?? "0.900";
		const envStr = env
			? [
					env.timeOfDay && `timeOfDay="${env.timeOfDay}"`,
					env.weather && `weather="${env.weather}"`,
					env.skybox && `skybox="${env.skybox}"`,
					env.ambientLight && `ambientLight="${env.ambientLight}"`,
				]
					.filter(Boolean)
					.join(", ")
			: null;
		const baseUserMessage = `Scene context: objectName="${ctx.objectName}", sceneId="${ctx.sceneId}", objectPosition=(${posStr}), displayY=${displayY}, displayWidth=${displayW}, displayHeight=${displayH}${envStr ? `, environment=(${envStr})` : ""}\n\nUser request: ${userRequest}${designContext}`;

		let code = "";
		let lastErr: string | null = null;
		const MAX_RETRIES = 2;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			const userMessage =
				lastErr === null
					? baseUserMessage
					: `${baseUserMessage}${designConstraints}\n\n## Code review feedback (fix all issues before resubmitting)\n${lastErr}`;

			let rawCode: string;
			try {
				const response = await completeSimple(model, {
					systemPrompt: systemPrompt,
					messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
				});
				rawCode = response.content
					.filter((c) => c.type === "text")
					.map((c) => (c as { type: "text"; text: string }).text)
					.join("")
					.trim()
					.replace(/^```[\w]*\n?/m, "")
					.replace(/\n?```$/m, "")
					.trim();
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { type: "markdown", content: `**代码生成失败:** ${msg}`, title: "错误" };
			}

			const violations = reviewGeneratedCode(rawCode, userRequest);
			if (violations.length === 0 || attempt === MAX_RETRIES) {
				code = rawCode;
				if (violations.length > 0) {
					console.warn(
						`[code-gen] static review violations (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
						violations,
					);
				}
				break;
			}

			lastErr = violations.map((v, i) => `${i + 1}. ${v}`).join("\n");
			console.log(`[code-gen] retry ${attempt + 1} — violations:\n${lastErr}`);
		}

		console.log(`[code-gen] generated code:\n${code}`);
		return { type: "script", code, title };
	},
};
