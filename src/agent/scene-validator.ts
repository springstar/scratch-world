/**
 * scene-validator.ts
 *
 * Static analysis of sceneCode before it is stored and sent to the renderer.
 * Catches common spatial and code-quality violations so the agent can self-correct
 * before the user sees a broken scene.
 *
 * Design principle: every rule is derived from a *general* spatial constraint
 * (e.g. "background elements cannot occlude foreground structures"), not from a
 * specific scene bug. Rules are expressed as patterns that apply to all scene types.
 */

export interface SceneViolation {
	/** Machine-readable rule ID */
	rule: string;
	/** Human-readable description of what is wrong and how to fix it */
	message: string;
	/** Severity: "error" breaks the scene; "warning" degrades quality */
	severity: "error" | "warning";
}

export interface ValidationResult {
	valid: boolean;
	violations: SceneViolation[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract all numeric position arguments from a function call pattern.
 *  Returns {x, z} pairs found. y is ignored for 2D overlap checks. */
function extractPositions(code: string, fnPattern: RegExp): Array<{ x: number; z: number }> {
	const results: Array<{ x: number; z: number }> = [];
	let m = fnPattern.exec(code);
	while (m !== null) {
		// Look for position: { x: N, y: N, z: N } near this match
		const snippet = code.slice(m.index, m.index + 400);
		const posMatch = snippet.match(/position\s*:\s*\{[^}]*x\s*:\s*(-?[\d.]+)[^}]*z\s*:\s*(-?[\d.]+)/);
		if (posMatch) {
			results.push({ x: parseFloat(posMatch[1]), z: parseFloat(posMatch[2]) });
		}
		m = fnPattern.exec(code);
	}
	return results;
}

/** Estimate the bounding Z range of major structures (floors, walls, buildings)
 *  so we can tell whether background terrain falls inside them. */
function estimateStructureBounds(code: string): { minZ: number; maxZ: number } | null {
	// Collect z positions from makeTerrain("floor"/"wall"/"court") and makeBuilding calls
	const floorPattern = /makeTerrain\(\s*["'](floor|wall|court|ceiling)["']/g;
	const buildingPattern = /makeBuilding\s*\(/g;

	const positions: number[] = [];
	for (const pos of extractPositions(code, floorPattern)) positions.push(pos.z);
	for (const pos of extractPositions(code, buildingPattern)) positions.push(pos.z);

	if (positions.length === 0) return null;

	// Find the depth extent: stadium walls define the boundary
	const zValues = positions.filter((z) => Math.abs(z) < 500); // sanity filter
	const minZ = Math.min(...zValues);
	const maxZ = Math.max(...zValues);

	// Add a margin: anything within ±20 of a wall position is still "inside"
	return { minZ: minZ - 20, maxZ: maxZ + 20 };
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * RULE: No shadow-casting extra lights.
 * General constraint: only the directional sun may cast shadows. All other lights
 * (SpotLight, PointLight) must use castShadow = false. Shadow-casting extra lights
 * cause camera-movement flicker artifacts and consume WebGPU texture slots.
 */
function checkShadowLights(code: string): SceneViolation[] {
	const violations: SceneViolation[] = [];
	// Match SpotLight or PointLight constructions followed by castShadow = true
	const lightShadowPattern = /new\s+THREE\.(SpotLight|PointLight)[^;]{0,300}\.castShadow\s*=\s*true/gs;
	// Also match the reverse order: castShadow = true near a SpotLight/PointLight
	const reverseShadowPattern =
		/(SpotLight|PointLight)[^\n]{0,100}\n(?:[^\n]{0,100}\n){0,5}[^\n]*castShadow\s*=\s*true/g;

	if (lightShadowPattern.test(code) || reverseShadowPattern.test(code)) {
		violations.push({
			rule: "no-extra-light-shadows",
			severity: "error",
			message:
				"One or more SpotLights or PointLights have castShadow = true. " +
				"This causes shadow-map flicker when the camera moves and may cause a black screen on Apple Silicon. " +
				"Fix: set castShadow = false on ALL lights except the stdlib directional sun.",
		});
	}
	return violations;
}

/**
 * RULE: No direct property assignment on Three.js objects.
 * General constraint: Three.js position/rotation/scale are read-only getters returning
 * Vector3/Euler. Direct assignment throws at runtime. Always use .set() or .copy().
 */
function checkDirectAssignment(code: string): SceneViolation[] {
	const violations: SceneViolation[] = [];

	// Detect: Object.assign(mesh, { position: ... }) or Object.assign(new THREE.*, ...)
	// Note: [^,]+ misses nested commas, so also check for Object.assign(new THREE.* directly.
	if (
		/Object\.assign\s*\([^,]+,\s*\{[^}]*(position|rotation|scale)/g.test(code) ||
		/Object\.assign\s*\(\s*new\s+THREE\./g.test(code)
	) {
		violations.push({
			rule: "no-object-assign-transform",
			severity: "error",
			message:
				"Object.assign() is being used to set position/rotation/scale on a Three.js object. " +
				"These are read-only getters — assignment silently fails or throws. " +
				"Fix: use mesh.position.set(x, y, z) and mesh.rotation.set(rx, ry, rz) instead.",
		});
	}

	// Detect: mesh.position = new THREE.Vector3(...) or mesh.position = { x, y, z }
	if (/\.\s*(position|rotation|scale)\s*=\s*(new\s+THREE\.|{)/g.test(code)) {
		violations.push({
			rule: "no-direct-transform-assignment",
			severity: "error",
			message:
				"Direct assignment to .position / .rotation / .scale detected. " +
				"These properties are read-only getters on Three.js objects. " +
				"Fix: use .position.set(x, y, z) instead of .position = new THREE.Vector3(x, y, z).",
		});
	}

	return violations;
}

/**
 * RULE: setupLighting must be called.
 * General constraint: the renderer mutes its built-in lights for all sceneCode scenes.
 * Without stdlib.setupLighting(), the scene is pitch black.
 */
function checkSetupLighting(code: string): SceneViolation[] {
	if (!/stdlib\s*\.\s*setupLighting\s*\(/.test(code)) {
		return [
			{
				rule: "missing-setup-lighting",
				severity: "error",
				message:
					"stdlib.setupLighting() is not called. The renderer mutes its built-in lights for " +
					"sceneCode scenes — without this call, the scene will be completely dark. " +
					"Fix: add stdlib.setupLighting({ skybox: 'clear_day', hdri: true }) as the first line.",
			},
		];
	}
	return [];
}

/**
 * RULE: Background terrain must not overlap foreground structures.
 * General constraint: elements placed in the background (hills, distant trees) must be
 * positioned beyond the far boundary of any foreground structure. A hill inside a
 * stadium, arena, or building is spatially impossible and blocks the interior view.
 *
 * Detection: estimate the structure's z-extent from floor/wall/building positions,
 * then check whether any makeTerrain("hill") positions fall within that range.
 */
function checkTerrainInsideStructure(code: string): SceneViolation[] {
	const hillPattern = /makeTerrain\(\s*["']hill["']/g;
	const hillPositions = extractPositions(code, hillPattern);

	if (hillPositions.length === 0) return [];

	const bounds = estimateStructureBounds(code);
	if (!bounds) return [];

	const inside = hillPositions.filter((p) => p.z > bounds.minZ && p.z < bounds.maxZ);
	if (inside.length === 0) return [];

	return [
		{
			rule: "terrain-inside-structure",
			severity: "error",
			message:
				`${inside.length} hill(s) are positioned inside or overlapping the main structure bounds ` +
				`(estimated structure z range: ${bounds.minZ.toFixed(0)} to ${bounds.maxZ.toFixed(0)}). ` +
				"Hills must be placed beyond the far wall of any stadium/arena/building — at least 30 m outside. " +
				`Fix: move hill positions to z < ${(bounds.minZ - 30).toFixed(0)} or z > ${(bounds.maxZ + 30).toFixed(0)}.`,
		},
	];
}

/**
 * RULE: Indoor scenes must not render world ground visible.
 * General constraint: when isIndoor: true is set, the caller is declaring the scene
 * is fully enclosed. Rendering outdoor ground through the floor is a spatial error.
 * (The renderer now hides world ground automatically, but check scene.fog = null is set.)
 */
function checkIndoorFog(code: string): SceneViolation[] {
	const isIndoor = /setupLighting\s*\(\s*\{[^}]*isIndoor\s*:\s*true/.test(code);
	if (!isIndoor) return [];
	if (/scene\s*\.\s*fog\s*=\s*null/.test(code)) return [];
	return [
		{
			rule: "indoor-fog-not-disabled",
			severity: "warning",
			message:
				"Indoor scene (isIndoor: true) does not set scene.fog = null. " +
				"Fog at y=0 creates an unnatural haze inside enclosed spaces. " +
				"Fix: add scene.fog = null immediately after stdlib.setupLighting().",
		},
	];
}

/**
 * RULE: animate() callbacks must not call Math.random().
 * General constraint: Math.random() inside a per-frame callback creates non-deterministic
 * jitter every frame, causing visual noise. All random values must be precomputed.
 */
function checkRandomInAnimate(code: string): SceneViolation[] {
	// Find animate( ... Math.random() ... ) — simplified: look for Math.random inside
	// an animate callback body. We look for Math.random() appearing after animate(
	const animateBlocks =
		code.match(/animate\s*\(\s*(?:\([^)]*\)|[a-zA-Z_$][^\s]*)\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g) ?? [];
	for (const block of animateBlocks) {
		if (/Math\.random\s*\(/.test(block)) {
			return [
				{
					rule: "random-in-animate",
					severity: "warning",
					message:
						"Math.random() is called inside an animate() callback. This creates per-frame jitter. " +
						"Fix: precompute all random values before the animate() call and reference them inside.",
				},
			];
		}
	}
	return [];
}

/**
 * RULE: Structural terrain and buildings should use the layout solver.
 * General constraint: placing hills, buildings, and boundary elements with raw
 * coordinates is error-prone — hills end up inside stadiums, bleachers float mid-air.
 * stdlib.useLayout() encodes all spatial rules in one place and prevents these errors.
 *
 * This is a warning (not an error) so existing raw-coordinate scenes still work.
 * It nudges the agent toward the layout API for new scene generation.
 */
function checkMissingLayout(code: string): SceneViolation[] {
	// Only warn when the code creates structural outdoor elements without useLayout()
	const hasStructural = /makeTerrain\(\s*["'](hill|cliff)["']/.test(code) || /makeBuilding\s*\(/.test(code);
	if (!hasStructural) return [];
	if (/useLayout\s*\(/.test(code)) return [];
	return [
		{
			rule: "missing-layout-solver",
			severity: "warning",
			message:
				"Scene creates hills or buildings without calling stdlib.useLayout(). " +
				"Raw coordinates for terrain and structures are error-prone — hills may overlap structures, " +
				"bleachers may clip into walls. " +
				"Fix: call stdlib.useLayout('outdoor_soccer' | 'outdoor_open' | 'indoor_arena' | ...) " +
				"and use L.buildBase() + L.place(role) instead of manually positioning structural elements.",
		},
	];
}

/**
 * RULE: Asset pre-scan must not be skipped.
 * General constraint: before writing sceneCode, the agent must call find_gltf_assets
 * for the scene's main object categories. If sceneCode contains multiple user-defined
 * object-construction functions that use primitive geometry (Box/Cylinder/SphereGeometry)
 * AND contains zero loadModel() / placeAsset() calls, the asset pre-scan was skipped.
 *
 * This rule is type-agnostic — it applies equally to animals, buildings, vehicles, props.
 * Detection: count named functions (function foo() or const foo = () =>) whose bodies
 * contain primitive geometry constructors. If ≥ 2 such functions exist and no loadModel
 * or placeAsset is present, the pre-scan was almost certainly skipped.
 */
function checkAssetPrescan(code: string): SceneViolation[] {
	// Skip if loadModel or placeAsset is already present — pre-scan was done.
	if (/stdlib\s*\.\s*(loadModel|placeAsset)\s*\(/.test(code)) return [];

	const PRIMITIVE_GEO = /new\s+THREE\.(BoxGeometry|CylinderGeometry|SphereGeometry|ConeGeometry)/;
	const FN_PATTERN =
		/(?:function\s+[\w$]+\s*\([^)]*\)\s*\{|const\s+[\w$]+\s*=\s*(?:function\s*\([^)]*\)|[^=>{]+=>)\s*\{)([\s\S]{0,1200}?)\}/g;

	let count = 0;
	let m = FN_PATTERN.exec(code);
	while (m !== null) {
		if (PRIMITIVE_GEO.test(m[1] ?? "")) count++;
		m = FN_PATTERN.exec(code);
	}

	if (count >= 2) {
		return [
			{
				rule: "asset-prescan-skipped",
				severity: "error",
				message:
					`sceneCode defines ${count} object-construction functions using primitive geometry, ` +
					"but no loadModel() or placeAsset() calls were found. " +
					"The asset pre-scan step (Step 6 in pre-analysis) was skipped. " +
					"Fix: before writing sceneCode, call find_gltf_assets for the scene's top 3 object categories. " +
					"Use stdlib.loadModel(url, { scale, position }) for every resolved asset. " +
					"Only use stdlib geometry (makeBuilding, makeNpc, makeTree) for categories where find_gltf_assets returned no result.",
			},
		];
	}
	return [];
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface ValidateOptions {
	/** When true, skip the asset-prescan check (agent confirmed it ran find_gltf_assets). */
	skipAssetPrescan?: boolean;
}

export function validateSceneCode(code: string, opts: ValidateOptions = {}): ValidationResult {
	const violations: SceneViolation[] = [
		...checkSetupLighting(code),
		...checkShadowLights(code),
		...checkDirectAssignment(code),
		...checkTerrainInsideStructure(code),
		...checkIndoorFog(code),
		...checkRandomInAnimate(code),
		...checkMissingLayout(code),
		...(opts.skipAssetPrescan ? [] : checkAssetPrescan(code)),
	];

	return {
		valid: violations.filter((v) => v.severity === "error").length === 0,
		violations,
	};
}

/** Format violations as a compact string for inclusion in tool results. */
export function formatViolations(result: ValidationResult): string {
	if (result.valid && result.violations.length === 0) return "";
	const lines = [
		`⚠ Scene validation found ${result.violations.length} issue(s). You MUST call update_scene immediately to fix all errors before responding to the user:`,
		"",
		...result.violations.map((v, i) => `${i + 1}. [${v.severity.toUpperCase()}] ${v.rule}\n   ${v.message}`),
		"",
		"Fix all issues listed above in your next update_scene call.",
	];
	return lines.join("\n");
}
