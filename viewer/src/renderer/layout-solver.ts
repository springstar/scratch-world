/**
 * layout-solver.ts
 *
 * Semantic layout engine for scene generation.
 * The AI declares a scene TYPE and ELEMENT ROLES; this module computes all x,y,z positions.
 * The AI never writes raw coordinates for structural elements.
 *
 * Usage in sceneCode:
 *   const L = stdlib.useLayout("outdoor_soccer");
 *   stdlib.setupLighting({ skybox: "clear_day", hdri: true });
 *   L.buildBase();
 *   const goal = L.place("north_goal");
 *   const vp = L.viewpoint("sideline");
 *   camera.position.set(vp.position.x, vp.position.y, vp.position.z);
 *   controls.target.set(vp.lookAt.x, vp.lookAt.y, vp.lookAt.z);
 */

import type * as THREE from "three/webgpu";
import { Group } from "three/webgpu";
import type { StdlibApi } from "./scene-stdlib.js";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

/** Canonical dimensions for a scene type. Exposed on SceneLayout.dims. */
export interface SceneDims {
	// Primary surface: width along X, depth along Z
	width: number;
	depth: number;
	height: number; // ceiling height (indoor) or visual horizon height (outdoor)
	// Boundary: the outermost structural extent (used to place backgrounds safely)
	structureMinZ: number;
	structureMaxZ: number;
	structureMinX: number;
	structureMaxX: number;
}

export interface ViewpointDef {
	position: Vec3;
	lookAt: Vec3;
}

export interface LayoutOpts {
	/** Override field/room width (X) */
	width?: number;
	/** Override field/room depth (Z) */
	depth?: number;
	/** Override height */
	height?: number;
}

// ── Scene type definitions ────────────────────────────────────────────────────

type SceneType =
	| "indoor_room"
	| "indoor_arena"
	| "outdoor_soccer"
	| "outdoor_basketball"
	| "outdoor_open"
	| "outdoor_street"
	| "outdoor_riverside"
	| "outdoor_hillside";

interface RoleResult {
	position: Vec3;
	rotationY?: number;
	scale?: number;
}

type RoleFn = (dims: SceneDims) => RoleResult;

/**
 * A spatial zone within the scene — roughly Voronoi-inspired.
 * The AI uses zone center + radius to drive scatter placement
 * instead of inventing absolute coordinates.
 */
export interface ZoneDef {
	/** Semantic identifier, e.g. "forest_left", "river_channel", "settlement_right" */
	id: string;
	/** Zone center X in world space */
	cx: number;
	/** Zone center Z in world space */
	cz: number;
	/** Approximate radius in metres — soft boundary, not a hard clip */
	radius: number;
	/** Dominant content type for this zone */
	type: "forest" | "water" | "settlement" | "rock" | "field" | "transition" | "open";
	/** Normalized placement density 0 (empty) → 1 (biome maximum) */
	density: number;
}

interface SceneTypeDef {
	baseDims: (opts: LayoutOpts) => SceneDims;
	roles: Record<string, RoleFn>;
	viewpoints: Record<string, (dims: SceneDims) => ViewpointDef>;
	zones?: (dims: SceneDims) => ZoneDef[];
}

// ── Role helpers ──────────────────────────────────────────────────────────────

function v(x: number, y: number, z: number): Vec3 {
	return { x, y, z };
}

// ── Scene type registry ───────────────────────────────────────────────────────

const SCENE_TYPES: Record<SceneType, SceneTypeDef> = {

	// ── Indoor room / office / bedroom ──────────────────────────────────────────
	indoor_room: {
		baseDims: (opts) => {
			const w = opts.width ?? 6;
			const d = opts.depth ?? 8;
			const h = opts.height ?? 2.8;
			return { width: w, depth: d, height: h,
				structureMinZ: -d / 2, structureMaxZ: d / 2,
				structureMinX: -w / 2, structureMaxX: w / 2 };
		},
		roles: {
			desk:      (d) => ({ position: v(0, 0, d.depth * 0.1) }),
			bed:       (d) => ({ position: v(d.width * 0.3, 0, -d.depth * 0.2) }),
			bookshelf: (d) => ({ position: v(-d.width * 0.45, 0, d.depth * 0.3), rotationY: Math.PI / 2 }),
			window_north: (d) => ({ position: v(0, d.height * 0.55, -d.depth / 2 + 0.01) }),
			window_south: (d) => ({ position: v(0, d.height * 0.55,  d.depth / 2 - 0.01), rotationY: Math.PI }),
			door_south:   (d) => ({ position: v(d.width * 0.3, d.height * 0.38, d.depth / 2 - 0.01), rotationY: Math.PI }),
			ceiling_light:(d) => ({ position: v(0, d.height - 0.15, 0) }),
		},
		viewpoints: {
			default: (d) => ({ position: v(0, 1.7, d.depth / 2 - 1.0), lookAt: v(0, 1.5, 0) }),
			overview: (d) => ({ position: v(0, d.height * 0.9, d.depth * 0.45), lookAt: v(0, 1.0, 0) }),
		},
	},

	// ── Indoor sports arena (basketball, volleyball, boxing) ────────────────────
	indoor_arena: {
		baseDims: (opts) => {
			const w  = opts.width  ?? 28;   // NBA court 28 m
			const d  = opts.depth  ?? 15;   // NBA court 15 m
			const h  = opts.height ?? 10;   // arena ceiling
			// Include bleachers in structural bounds
			const bMargin = 8;
			return { width: w, depth: d, height: h,
				structureMinZ: -(d / 2 + bMargin), structureMaxZ: (d / 2 + bMargin),
				structureMinX: -(w / 2 + bMargin), structureMaxX: (w / 2 + bMargin) };
		},
		roles: {
			// Basketball hoops — 3.05 m rim, pole 0.6 m outside baseline
			hoop_north: (d) => ({ position: v(0, 0, -(d.depth / 2 + 0.6)) }),
			hoop_south: (d) => ({ position: v(0, 0,  (d.depth / 2 + 0.6)), rotationY: Math.PI }),
			// Bleacher rows (long sides)
			bleachers_west: (d) => ({
				position: v(-(d.width / 2 + 3), 0, 0),
				rotationY: Math.PI / 2,
				scale: d.depth / 15,
			}),
			bleachers_east: (d) => ({
				position: v(d.width / 2 + 3, 0, 0),
				rotationY: -Math.PI / 2,
				scale: d.depth / 15,
			}),
			// Center court markings origin
			center_court: (_d) => ({ position: v(0, 0, 0) }),
			// Scoreboards (end walls, high up)
			scoreboard_north: (d) => ({ position: v(0, d.height * 0.65, -(d.depth / 2 + 2)) }),
			scoreboard_south: (d) => ({ position: v(0, d.height * 0.65,  (d.depth / 2 + 2)), rotationY: Math.PI }),
			// Ceiling light rigs (4 corners)
			light_nw: (d) => ({ position: v(-d.width * 0.35, d.height - 0.5, -d.depth * 0.35) }),
			light_ne: (d) => ({ position: v( d.width * 0.35, d.height - 0.5, -d.depth * 0.35) }),
			light_sw: (d) => ({ position: v(-d.width * 0.35, d.height - 0.5,  d.depth * 0.35) }),
			light_se: (d) => ({ position: v( d.width * 0.35, d.height - 0.5,  d.depth * 0.35) }),
		},
		viewpoints: {
			default:  (d) => ({ position: v(0, 2.5, d.depth / 2 + 8), lookAt: v(0, 1.5, 0) }),
			sideline: (d) => ({ position: v(d.width / 2 + 6, 4, 0), lookAt: v(0, 1.5, 0) }),
			overview: (d) => ({ position: v(0, d.height * 0.85, d.depth * 0.8), lookAt: v(0, 1, 0) }),
			end_zone: (d) => ({ position: v(2, 2, -(d.depth / 2 + 5)), lookAt: v(0, 1.5, 0) }),
		},
	},

	// ── Outdoor soccer field ─────────────────────────────────────────────────────
	outdoor_soccer: {
		baseDims: (opts) => {
			const w = opts.width  ?? 100;  // FIFA standard 100 m
			const d = opts.depth  ?? 68;   // FIFA standard 68 m
			return { width: w, depth: d, height: 0,
				structureMinZ: -d / 2 - 5, structureMaxZ: d / 2 + 5,
				structureMinX: -w / 2 - 5, structureMaxX: w / 2 + 5 };
		},
		roles: {
			// Goals — at the end lines (north = negative Z, south = positive Z)
			north_goal: (d) => ({ position: v(0, 0, -(d.depth / 2)), rotationY: Math.PI }),
			south_goal: (d) => ({ position: v(0, 0,  (d.depth / 2)) }),
			// Center circle
			center_circle: (_d) => ({ position: v(0, 0.01, 0) }),
			// Corner flags
			corner_nw: (d) => ({ position: v(-d.width / 2, 0, -d.depth / 2) }),
			corner_ne: (d) => ({ position: v( d.width / 2, 0, -d.depth / 2) }),
			corner_sw: (d) => ({ position: v(-d.width / 2, 0,  d.depth / 2) }),
			corner_se: (d) => ({ position: v( d.width / 2, 0,  d.depth / 2) }),
			// Penalty spots
			penalty_north: (d) => ({ position: v(0, 0.01, -(d.depth / 2 - 11)) }),
			penalty_south: (d) => ({ position: v(0, 0.01,  (d.depth / 2 - 11)) }),
			// Bleachers (long sides)
			bleachers_west: (d) => ({
				position: v(-(d.width / 2 + 8), 0, 0),
				rotationY: Math.PI / 2,
				scale: d.depth / 68,
			}),
			bleachers_east: (d) => ({
				position: v( (d.width / 2 + 8), 0, 0),
				rotationY: -Math.PI / 2,
				scale: d.depth / 68,
			}),
		},
		viewpoints: {
			default:  (d) => ({ position: v(0, 8, d.depth / 2 + 20), lookAt: v(0, 1, 0) }),
			sideline: (d) => ({ position: v(d.width / 2 + 15, 8, 0), lookAt: v(0, 1, 0) }),
			overview: (d) => ({ position: v(0, d.depth * 0.6, d.depth * 0.8), lookAt: v(0, 0, 0) }),
			end_zone: (d) => ({ position: v(5, 4, -(d.depth / 2 + 15)), lookAt: v(0, 1, 0) }),
		},
	},

	// ── Outdoor basketball court ─────────────────────────────────────────────────
	outdoor_basketball: {
		baseDims: (opts) => {
			const w = opts.width  ?? 28;
			const d = opts.depth  ?? 15;
			return { width: w, depth: d, height: 0,
				structureMinZ: -d / 2 - 3, structureMaxZ: d / 2 + 3,
				structureMinX: -w / 2 - 3, structureMaxX: w / 2 + 3 };
		},
		roles: {
			hoop_north: (d) => ({ position: v(0, 0, -(d.depth / 2 + 0.6)) }),
			hoop_south: (d) => ({ position: v(0, 0,  (d.depth / 2 + 0.6)), rotationY: Math.PI }),
			bench_west: (d) => ({ position: v(-(d.width / 2 + 2), 0, 0), rotationY: Math.PI / 2 }),
			bench_east: (d) => ({ position: v( (d.width / 2 + 2), 0, 0), rotationY: -Math.PI / 2 }),
		},
		viewpoints: {
			default:  (d) => ({ position: v(0, 3, d.depth / 2 + 10), lookAt: v(0, 1.5, 0) }),
			sideline: (d) => ({ position: v(d.width / 2 + 6, 4, 0), lookAt: v(0, 1.5, 0) }),
			end_zone: (d) => ({ position: v(2, 2, -(d.depth / 2 + 8)), lookAt: v(0, 1.5, 0) }),
		},
	},

	// ── Outdoor open space (park, plaza, garden) ─────────────────────────────────
	outdoor_open: {
		baseDims: (opts) => {
			const w = opts.width  ?? 80;
			const d = opts.depth  ?? 80;
			return { width: w, depth: d, height: 0,
				structureMinZ: -d / 2, structureMaxZ: d / 2,
				structureMinX: -w / 2, structureMaxX: w / 2 };
		},
		roles: {
			center:      (_d) => ({ position: v(0, 0, 0) }),
			bench_north: (d) => ({ position: v(0, 0, -d.depth * 0.25), rotationY: Math.PI }),
			bench_south: (d) => ({ position: v(0, 0,  d.depth * 0.25) }),
			bench_west:  (d) => ({ position: v(-d.width * 0.25, 0, 0), rotationY: Math.PI / 2 }),
			bench_east:  (d) => ({ position: v( d.width * 0.25, 0, 0), rotationY: -Math.PI / 2 }),
			fountain:    (_d) => ({ position: v(0, 0, 0) }),
			lamp_nw:     (d) => ({ position: v(-d.width * 0.3, 0, -d.depth * 0.3) }),
			lamp_ne:     (d) => ({ position: v( d.width * 0.3, 0, -d.depth * 0.3) }),
			lamp_sw:     (d) => ({ position: v(-d.width * 0.3, 0,  d.depth * 0.3) }),
			lamp_se:     (d) => ({ position: v( d.width * 0.3, 0,  d.depth * 0.3) }),
		},
		viewpoints: {
			default:  (d) => ({ position: v(0, 4, d.depth * 0.45), lookAt: v(0, 1, 0) }),
			overview: (d) => ({ position: v(0, d.width * 0.4, d.width * 0.5), lookAt: v(0, 0, 0) }),
		},
		zones: (d) => [
			{ id: "plaza_center",     cx: 0, cz: 0, radius: d.width * 0.20, type: "open",       density: 0.1 },
			{ id: "perimeter_forest", cx: 0, cz: 0, radius: d.width * 0.45, type: "forest",     density: 0.6 },
			{ id: "corner_accents",   cx: 0, cz: 0, radius: d.width * 0.50, type: "transition", density: 0.4 },
		],
	},

	// ── Outdoor street corridor ──────────────────────────────────────────────────
	outdoor_street: {
		baseDims: (opts) => {
			const w = opts.width  ?? 10;  // road width
			const d = opts.depth  ?? 80;  // street length
			const buildingDepth = 8;
			return { width: w, depth: d, height: 0,
				structureMinZ: -d / 2,        structureMaxZ: d / 2,
				structureMinX: -(w / 2 + buildingDepth), structureMaxX: (w / 2 + buildingDepth) };
		},
		roles: {
			lamp_left_near:  (d) => ({ position: v(-d.width / 2 - 0.5,  0, -d.depth * 0.25) }),
			lamp_left_mid:   (d) => ({ position: v(-d.width / 2 - 0.5,  0,  0) }),
			lamp_left_far:   (d) => ({ position: v(-d.width / 2 - 0.5,  0,  d.depth * 0.25) }),
			lamp_right_near: (d) => ({ position: v( d.width / 2 + 0.5,  0, -d.depth * 0.25) }),
			lamp_right_mid:  (d) => ({ position: v( d.width / 2 + 0.5,  0,  0) }),
			lamp_right_far:  (d) => ({ position: v( d.width / 2 + 0.5,  0,  d.depth * 0.25) }),
		},
		viewpoints: {
			default: (d) => ({ position: v(0, 1.7, d.depth * 0.45), lookAt: v(0, 1.7, -d.depth * 0.1) }),
			overview:(d) => ({ position: v(d.width * 2, d.width * 2, d.depth * 0.4), lookAt: v(0, 1, 0) }),
		},
		zones: (d) => [
			{ id: "road_center", cx:  0,              cz: 0, radius: d.width * 0.25, type: "open",       density: 0   },
			{ id: "sidewalk_l",  cx: -d.width * 0.40, cz: 0, radius: d.width * 0.15, type: "transition", density: 0.3 },
			{ id: "sidewalk_r",  cx:  d.width * 0.40, cz: 0, radius: d.width * 0.15, type: "transition", density: 0.3 },
		],
	},

	// ── Outdoor riverside settlement (river as central axis) ─────────────────────
	// Use for: river valleys, stilted waterfront towns, Fenghuang-style settlements
	outdoor_riverside: {
		baseDims: (opts) => {
			const w = opts.width  ?? 60;  // valley width (bank to bank + hillside)
			const d = opts.depth  ?? 80;  // valley length (scene depth)
			return { width: w, depth: d, height: 0,
				structureMinZ: -d / 2, structureMaxZ: d / 2,
				structureMinX: -w / 2, structureMaxX: w / 2 };
		},
		roles: {
			// River runs along Z-axis, centered on X=0
			river:             (_d) => ({ position: v(0, 0, 0) }),
			// Stilted houses — left bank, hanging over water edge
			stilt_house_left:  (d) => ({ position: v(-d.width * 0.20, 0, 0),            rotationY: Math.PI / 2 }),
			stilt_house_left2: (d) => ({ position: v(-d.width * 0.22, 0, -d.depth * 0.18) }),
			stilt_house_left3: (d) => ({ position: v(-d.width * 0.18, 0,  d.depth * 0.18) }),
			// Right-bank houses — set back from water
			house_right_near:  (d) => ({ position: v(d.width * 0.32, 0, -d.depth * 0.15) }),
			house_right_far:   (d) => ({ position: v(d.width * 0.36, 0,  d.depth * 0.15) }),
			house_right_mid:   (d) => ({ position: v(d.width * 0.38, 0,  0) }),
			// Dock / landing — extends from right bank into river
			dock:              (d) => ({ position: v(d.width * 0.10, 0, 0) }),
			// Karst peaks — distant background on both sides of the valley
			peak_left:         (d) => ({ position: v(-d.width * 0.55, 0, -d.depth * 0.35) }),
			peak_right:        (d) => ({ position: v( d.width * 0.60, 0, -d.depth * 0.40) }),
			peak_far:          (d) => ({ position: v( d.width * 0.05, 0, -d.depth * 0.55) }),
			// Boat on river
			boat:              (d) => ({ position: v(d.width * 0.05, 0, d.depth * 0.10) }),
			// Bridge crossing point
			bridge:            (d) => ({ position: v(0, 0, -d.depth * 0.20) }),
		},
		viewpoints: {
			// Standing on right bank, looking across river to stilt houses
			default:  (d) => ({
				position: v(d.width * 0.35, 1.7,  d.depth * 0.30),
				lookAt:   v(-d.width * 0.10, 1.2, 0),
			}),
			// Aerial — river visible as central feature
			overview: (d) => ({
				position: v(0, d.width * 0.50, d.depth * 0.45),
				lookAt:   v(0, 0, 0),
			}),
			// From boat — low on water, looking upriver toward misty peaks
			boat_pov: (d) => ({
				position: v(d.width * 0.05, 1.2,  d.depth * 0.28),
				lookAt:   v(0, 3, -d.depth * 0.20),
			}),
		},
		zones: (d) => [
			{ id: "river_channel",    cx:  0,             cz: 0,               radius: d.width * 0.15, type: "water",      density: 0   },
			{ id: "left_bank_forest", cx: -d.width * 0.3, cz: -d.depth * 0.10, radius: d.width * 0.25, type: "forest",     density: 0.8 },
			{ id: "right_settlement", cx:  d.width * 0.3, cz:  0,              radius: d.width * 0.20, type: "settlement", density: 0.7 },
			{ id: "background_karst", cx:  0,             cz: -d.depth * 0.40, radius: d.width * 0.40, type: "rock",       density: 0.3 },
		],
	},

	// ── Outdoor hillside (terraced mountainside settlement) ─────────────────────
	// Use for: rice terraces, vineyard slopes, hill villages, Andes/Yunnan scenes
	outdoor_hillside: {
		baseDims: (opts) => {
			const w = opts.width  ?? 60;  // slope width
			const d = opts.depth  ?? 50;  // slope depth (front=viewer, back=uphill)
			const h = opts.height ?? 20;  // total elevation rise front → back
			return { width: w, depth: d, height: h,
				structureMinZ: -d, structureMaxZ: 5,
				structureMinX: -w / 2, structureMaxX: w / 2 };
		},
		roles: {
			// Terraced field — center-back, dominant anchor
			terrace_field:  (d) => ({ position: v(0, d.height * 0.30, -d.depth * 0.40) }),
			// Village cluster at mid-slope
			village_center: (d) => ({ position: v(0, d.height * 0.40, -d.depth * 0.50) }),
			// Individual houses at staggered elevations
			house_low:      (d) => ({ position: v(-d.width * 0.20, d.height * 0.15, -d.depth * 0.25) }),
			house_mid:      (d) => ({ position: v( d.width * 0.15, d.height * 0.40, -d.depth * 0.50) }),
			house_high:     (d) => ({ position: v(-d.width * 0.10, d.height * 0.65, -d.depth * 0.65) }),
			// Path winding up slope
			path_start: (d) => ({ position: v(d.width * 0.05, 0,                     0) }),
			path_mid:   (d) => ({ position: v(0,               d.height * 0.35, -d.depth * 0.45) }),
			path_top:   (d) => ({ position: v(-d.width * 0.05, d.height * 0.70, -d.depth * 0.70) }),
			// NPC on the path
			npc_path:   (d) => ({ position: v(d.width * 0.03, d.height * 0.15, -d.depth * 0.20) }),
			// Distant peak behind the top of the slope
			peak_bg:    (d) => ({ position: v(d.width * 0.20, d.height * 1.20, -d.depth * 1.10) }),
		},
		viewpoints: {
			// From front, looking up slope — terraces fill lower frame
			default: (d) => ({
				position: v(d.width * 0.30, 1.7, d.depth * 0.15),
				lookAt:   v(0, d.height * 0.40, -d.depth * 0.40),
			}),
			// From mid-slope looking down and across
			mid_slope: (d) => ({
				position: v(-d.width * 0.15, d.height * 0.45, -d.depth * 0.45),
				lookAt:   v( d.width * 0.10, 0, d.depth * 0.10),
			}),
			// Aerial — shows full slope + peak
			overview: (d) => ({
				position: v(d.width * 0.50, d.height * 1.50, d.depth * 0.30),
				lookAt:   v(0, d.height * 0.30, -d.depth * 0.30),
			}),
		},
		zones: (d) => [
			{ id: "valley_floor", cx: 0, cz:  d.depth * 0.35, radius: d.width * 0.30, type: "field",      density: 0.3 },
			{ id: "lower_slope",  cx: 0, cz:  d.depth * 0.10, radius: d.width * 0.28, type: "settlement", density: 0.6 },
			{ id: "mid_slope",    cx: 0, cz: -d.depth * 0.10, radius: d.width * 0.25, type: "forest",     density: 0.7 },
			{ id: "peak_zone",    cx: 0, cz: -d.depth * 0.35, radius: d.width * 0.20, type: "rock",       density: 0.2 },
		],
	},
};

// ── SceneLayout ────────────────────────────────────────────────────────────────

export interface LayoutHelpers {
	scene: THREE.Scene;
	stdlib: StdlibApi;
}

export class SceneLayout {
	readonly type: SceneType;
	readonly dims: SceneDims;

	private readonly def: SceneTypeDef;
	private readonly helpers: LayoutHelpers;

	constructor(type: SceneType, opts: LayoutOpts, helpers: LayoutHelpers) {
		this.type = type;
		this.helpers = helpers;
		const def = SCENE_TYPES[type];
		if (!def) throw new Error(`[layout-solver] Unknown scene type: "${type}". Valid types: ${Object.keys(SCENE_TYPES).join(", ")}`);
		this.def = def;
		this.dims = def.baseDims(opts);
	}

	// ── Base geometry builders ─────────────────────────────────────────────────

	/**
	 * Build the complete spatial skeleton for this scene type:
	 * ground/floor + walls/ceiling (indoor) OR ground + boundary + background (outdoor).
	 * Call this once at the start of sceneCode, after setupLighting().
	 */
	buildBase(): void {
		const isIndoor = this.type === "indoor_room" || this.type === "indoor_arena";
		if (isIndoor) {
			this.buildGround();
			this.buildWalls();
			this.buildCeiling();
		} else {
			this.buildGround();
			// Riverside: add river channel as part of the base structure
			if (this.type === "outdoor_riverside") {
				this.helpers.stdlib.makeRiver({
					width: this.dims.width * 0.30,
					length: this.dims.depth + 20,
					position: { x: 0, y: 0, z: 0 },
				});
			}
			this.buildBoundary();
			this.buildBackground();
		}
	}

	/** Build the ground / floor surface. */
	buildGround(): THREE.Object3D {
		const { stdlib } = this.helpers;
		const { dims, type } = this;
		const isIndoor = type === "indoor_room" || type === "indoor_arena";

		// Riverside: flat valley floor + river channel built into ground
		if (type === "outdoor_riverside") {
			const ground = stdlib.makeTerrain("floor", {
				width: dims.width + 80, depth: dims.depth + 80,
				texture: "aerial_grass_rock",
				position: { x: 0, y: 0, z: 0 },
			});
			this.helpers.scene.add(ground);
			// River is placed by buildBase(); return ground only here
			return ground;
		}

		// Hillside: sloped ground rising from front to back
		if (type === "outdoor_hillside") {
			const { THREE: THREELib } = this.helpers as unknown as { THREE: typeof import("three/webgpu") };
			// Fall back to flat terrain if THREE not available in helpers (TS safety)
			if (!THREELib) {
				const ground = stdlib.makeTerrain("floor", {
					width: dims.width + 60, depth: dims.depth + 60,
					texture: "aerial_grass_rock",
					position: { x: 0, y: dims.height / 2, z: -dims.depth / 2 },
				});
				this.helpers.scene.add(ground);
				return ground;
			}
			const slopeAngle = Math.atan2(dims.height, dims.depth);
			const slopeLen   = Math.sqrt(dims.depth * dims.depth + dims.height * dims.height);
			const ground = stdlib.makeTerrain("floor", {
				width: dims.width + 40, depth: slopeLen + 40,
				texture: "aerial_grass_rock",
				position: { x: 0, y: dims.height / 2, z: -dims.depth / 2 },
			});
			// Tilt the ground plane to form a slope
			(ground as THREE.Object3D).rotation.x = slopeAngle;
			this.helpers.scene.add(ground);
			return ground;
		}

		if (type === "outdoor_soccer" || type === "outdoor_basketball") {
			// Grass beyond field, then court/field surface on top
			const grassW = dims.width  + 40;
			const grassD = dims.depth  + 40;
			const grass = stdlib.makeTerrain("floor", {
				width: grassW, depth: grassD,
				texture: "aerial_grass_rock",
				position: { x: 0, y: 0, z: 0 },
			});
			this.helpers.scene.add(grass);

			// Field surface (court or grass pitch)
			const field = type === "outdoor_basketball"
				? stdlib.makeTerrain("court", { position: { x: 0, y: 0, z: 0 } })
				: stdlib.makeTerrain("floor", {
					width: dims.width, depth: dims.depth, color: 0x3a7a2a,
					texture: "football_field", position: { x: 0, y: 0.005, z: 0 },
				});
			this.helpers.scene.add(field);
			return field;
		}

		if (type === "outdoor_street") {
			// Road
			const road = stdlib.makeTerrain("floor", {
				width: dims.width, depth: dims.depth + 20,
				color: 0x484848, texture: "cobblestone_floor_01",
				position: { x: 0, y: 0, z: 0 },
			});
			this.helpers.scene.add(road);
			// Sidewalks
			for (const sx of [-1, 1]) {
				const sidewalk = stdlib.makeTerrain("floor", {
					width: 2, depth: dims.depth + 20, color: 0x999999,
					position: { x: sx * (dims.width / 2 + 1), y: 0.05, z: 0 },
				});
				this.helpers.scene.add(sidewalk);
			}
			return road;
		}

		const texture = isIndoor ? "concrete_floor_02" : "aerial_grass_rock";
		const groundW = isIndoor ? dims.width + 0.4 : dims.width + 80;
		const groundD = isIndoor ? dims.depth + 0.4 : dims.depth + 80;
		const ground = stdlib.makeTerrain("floor", {
			width: groundW, depth: groundD,
			texture, position: { x: 0, y: 0, z: 0 },
		});
		this.helpers.scene.add(ground);
		return ground;
	}

	/** Build 4 walls (indoor only). Throws for outdoor types. */
	buildWalls(): THREE.Object3D {
		if (this.type !== "indoor_room" && this.type !== "indoor_arena") {
			throw new Error(`[layout-solver] buildWalls() is only valid for indoor types, not "${this.type}"`);
		}
		const { stdlib, scene } = this.helpers;
		const { dims } = this;
		const hw = dims.width  / 2;
		const hd = dims.depth  / 2;
		const hh = dims.height / 2;
		const walls = [
			{ w: dims.width + 0.4, pos: { x: 0, y: hh, z: -hd },               rot: 0 },
			{ w: dims.width + 0.4, pos: { x: 0, y: hh, z:  hd },               rot: Math.PI },
			{ w: dims.depth + 0.4, pos: { x: -hw, y: hh, z: 0 },               rot: Math.PI / 2 },
			{ w: dims.depth + 0.4, pos: { x:  hw, y: hh, z: 0 },               rot: -Math.PI / 2 },
		];
		const group = new Group();
		for (const wall of walls) {
			const mesh = stdlib.makeTerrain("wall", {
				width: wall.w, height: dims.height,
				position: wall.pos,
			});
			if (wall.rot !== 0) (mesh as THREE.Object3D).rotation.y = wall.rot;
			scene.add(mesh);
			group.add(mesh as THREE.Object3D);
		}
		return group;
	}

	/** Build ceiling (indoor only). */
	buildCeiling(): THREE.Object3D {
		if (this.type !== "indoor_room" && this.type !== "indoor_arena") {
			throw new Error(`[layout-solver] buildCeiling() is only valid for indoor types, not "${this.type}"`);
		}
		const { stdlib, scene } = this.helpers;
		const { dims } = this;
		const ceiling = stdlib.makeTerrain("floor", {
			width: dims.width + 0.4, depth: dims.depth + 0.4,
			color: this.type === "indoor_arena" ? 0x888888 : 0xf0f0f0,
			position: { x: 0, y: dims.height, z: 0 },
		});
		// Flip ceiling to face downward
		(ceiling as THREE.Object3D).rotation.x = Math.PI;
		scene.add(ceiling);
		return ceiling;
	}

	/**
	 * Build perimeter boundary:
	 * - outdoor_soccer/basketball: spectator stands or tree rows on long sides
	 * - outdoor_open: tree line on all 4 sides
	 * - outdoor_street: building rows on both sides
	 * - indoor types: no-op (walls already cover this)
	 */
	buildBoundary(): THREE.Object3D {
		const { stdlib, scene } = this.helpers;
		const { dims, type } = this;
		const group = new Group();

		if (type === "outdoor_riverside") {
			// Riverside: cliff walls on both lateral sides of the valley
			for (const sx of [-1, 1]) {
				const cliff = stdlib.makeTerrain("cliff", {
					height: 20, width: dims.depth + 20,
					position: { x: sx * (dims.width / 2 + 2), y: 0, z: 0 },
				});
				(cliff as THREE.Object3D).rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
				scene.add(cliff);
				group.add(cliff);
			}
			return group;
		}

		if (type === "outdoor_hillside") {
			// Hillside: tree line along the lower front edge
			const frontCount = Math.ceil(dims.width / 8);
			for (let i = 0; i < frontCount; i++) {
				const x = (i / (frontCount - 1) - 0.5) * dims.width;
				const tree = stdlib.makeTree({ position: { x, y: 0, z: dims.depth * 0.12 }, scale: 1.1 });
				scene.add(tree);
				group.add(tree);
			}
			return group;
		}

		if (type === "outdoor_street") {
			// Building rows — both sides of road
			const spacing = 8;
			const count = Math.ceil(dims.depth / spacing);
			for (let i = 0; i < count; i++) {
				const z = -dims.depth / 2 + i * spacing + spacing * 0.5;
				for (const sx of [-1, 1]) {
					const x = sx * (dims.width / 2 + 5);
					const seed = Math.abs(Math.round(x * 3.7 + z * 5.3));
					const h = 6 + (seed % 5) * 2;
					const b = stdlib.makeBuilding({
						width: 6, depth: 8, height: h,
						position: { x, y: 0, z },
						rotationY: sx > 0 ? -Math.PI / 2 : Math.PI / 2,
					});
					scene.add(b);
					group.add(b);
				}
			}
			return group;
		}

		if (type === "outdoor_soccer" || type === "outdoor_basketball") {
			// Tree rows behind each goal (north and south ends)
			const treeZ = [dims.structureMinZ - 5, dims.structureMaxZ + 5];
			for (const tz of treeZ) {
				const treeCount = 6;
				for (let i = 0; i < treeCount; i++) {
					const tx = (i / (treeCount - 1) - 0.5) * (dims.width * 0.9);
					const tree = stdlib.makeTree({ position: { x: tx, y: 0, z: tz } });
					scene.add(tree);
					group.add(tree);
				}
			}
			return group;
		}

		if (type === "outdoor_open") {
			// Tree line on all 4 sides
			const sides = [
				{ axis: "x" as const, val: -dims.width / 2 - 3, along: dims.depth, dir: "z" as const },
				{ axis: "x" as const, val:  dims.width / 2 + 3, along: dims.depth, dir: "z" as const },
				{ axis: "z" as const, val: -dims.depth / 2 - 3, along: dims.width, dir: "x" as const },
				{ axis: "z" as const, val:  dims.depth / 2 + 3, along: dims.width, dir: "x" as const },
			];
			for (const side of sides) {
				const count = Math.ceil(side.along / 7);
				for (let i = 0; i < count; i++) {
					const along = (i / (count - 1) - 0.5) * side.along;
					const pos = side.dir === "z"
						? { x: side.val, y: 0, z: along }
						: { x: along,   y: 0, z: side.val };
					const tree = stdlib.makeTree({ position: pos });
					scene.add(tree);
					group.add(tree);
				}
			}
			return group;
		}

		return group;
	}

	/**
	 * Build background elements (hills for outdoor scenes).
	 * Hills are always placed outside structureBounds + 30 m safety margin.
	 * This guarantees hills never overlap the primary structure.
	 */
	buildBackground(opts: { count?: number } = {}): THREE.Object3D {
		const { stdlib, scene } = this.helpers;
		const { dims, type } = this;
		const group = new Group();

		// Only applicable for outdoor scenes
		if (type === "indoor_room" || type === "indoor_arena") return group;

		const count = opts.count ?? 4;
		const safetyMargin = 30;

		// Background hills — north side (negative Z)
		const zNorth = dims.structureMinZ - safetyMargin;
		for (let i = 0; i < count; i++) {
			const frac = (i / (count - 1)) * 2 - 1; // -1 to 1
			const x = frac * dims.width * 0.6;
			const z = zNorth - i * 8;
			const w = 25 + (Math.abs(Math.round(x * 3 + z * 7)) % 15);
			const h = 8 + (Math.abs(Math.round(x * 5 + z * 11)) % 8);
			const hill = stdlib.makeTerrain("hill", {
				width: w, height: h,
				position: { x, y: 0, z },
			});
			scene.add(hill);
			group.add(hill);
		}

		// Background hills — south side (positive Z) for all scenes except street
		if (type !== "outdoor_street") {
			const zSouth = dims.structureMaxZ + safetyMargin;
			for (let i = 0; i < count; i++) {
				const frac = (i / (count - 1)) * 2 - 1;
				const x = frac * dims.width * 0.6;
				const z = zSouth + i * 8;
				const w = 22 + (Math.abs(Math.round(x * 3 + z * 7)) % 13);
				const h = 7 + (Math.abs(Math.round(x * 5 + z * 11)) % 7);
				const hill = stdlib.makeTerrain("hill", {
					width: w, height: h,
					position: { x, y: 0, z },
				});
				scene.add(hill);
				group.add(hill);
			}
		}

		return group;
	}

	/**
	 * Place a named role element. Computes the correct position from dims and
	 * adds the returned object to the scene (if the caller provides one via opts).
	 * Returns the computed position and rotation — use them to build the object.
	 *
	 * @example
	 *   const goalPos = L.place("north_goal");
	 *   // goalPos.position, goalPos.rotationY are correct
	 */
	place(role: string, _opts?: Record<string, unknown>): RoleResult {
		const roleFn = this.def.roles[role];
		if (!roleFn) {
			const available = Object.keys(this.def.roles).join(", ");
			throw new Error(`[layout-solver] Unknown role "${role}" for type "${this.type}". Available: ${available}`);
		}
		return roleFn(this.dims);
	}

	/**
	 * Get a safe camera position and lookAt target for this scene type.
	 * The camera is always inside the scene skeleton.
	 *
	 * @param name - "default" | "overview" | "sideline" | "end_zone" | "center"
	 */
	viewpoint(name = "default"): ViewpointDef {
		const vpFn = this.def.viewpoints[name] ?? this.def.viewpoints["default"];
		if (!vpFn) throw new Error(`[layout-solver] No viewpoint "${name}" for type "${this.type}"`);
		return vpFn(this.dims);
	}

	/**
	 * Returns spatial zone definitions for this scene type.
	 * Each zone has a centre (cx, cz), radius, type, and density hint.
	 * Use zones to drive scatter placement — no raw coordinate invention needed.
	 *
	 * @example
	 *   const zones = L.zones();
	 *   zones.filter(z => z.type === "forest")
	 *        .forEach(z => forestZone(z.cx, z.cz, z.radius, Math.round(20 * z.density)));
	 */
	zones(): ZoneDef[] {
		return this.def.zones ? this.def.zones(this.dims) : [];
	}
}

// ── Public factory ────────────────────────────────────────────────────────────

export function createLayout(
	type: string,
	opts: LayoutOpts,
	helpers: LayoutHelpers,
): SceneLayout {
	return new SceneLayout(type as SceneType, opts, helpers);
}
