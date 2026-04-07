/**
 * npc-perception.ts
 *
 * Builds the spatial perception context string injected into every NPC system prompt.
 *
 * Improvements over the original inline buildPerceptionContext:
 *  - NPC's own world position
 *  - Compass bearing (东/南/西/北…) for every nearby entity
 *  - Separate lists for other NPCs vs. physical objects
 *  - Crude 2D line-of-sight: flags buildings that lie between the NPC and the player
 *
 * Coordinate system (Three.js):
 *   +X = East,  -X = West
 *   +Z = South, -Z = North
 *   bearing from A to B = atan2(dx, -dz) ∈ [-π, π], 0 = North, π/2 = East
 */

import type { SceneObject, Vec3 } from "../scene/types.js";

// ── Geometry helpers ──────────────────────────────────────────────────────────

function dist2d(a: Vec3, b: Vec3): number {
	const dx = a.x - b.x;
	const dz = a.z - b.z;
	return Math.sqrt(dx * dx + dz * dz);
}

function compassBearing(from: Vec3, to: Vec3): string {
	const dx = to.x - from.x;
	const dz = to.z - from.z;
	if (Math.sqrt(dx * dx + dz * dz) < 0.1) return "原地";
	// atan2(dx, -dz): 0 = North (+Z decreasing = North), π/2 = East
	const angle = (Math.atan2(dx, -dz) * 180) / Math.PI;
	const norm = ((angle % 360) + 360) % 360;
	if (norm < 22.5 || norm >= 337.5) return "正北";
	if (norm < 67.5) return "东北";
	if (norm < 112.5) return "正东";
	if (norm < 157.5) return "东南";
	if (norm < 202.5) return "正南";
	if (norm < 247.5) return "西南";
	if (norm < 292.5) return "正西";
	return "西北";
}

/**
 * Distance from point P to the line segment AB in the XZ plane.
 */
function pointToSegmentDist2d(p: Vec3, a: Vec3, b: Vec3): number {
	const abx = b.x - a.x;
	const abz = b.z - a.z;
	const len2 = abx * abx + abz * abz;
	if (len2 < 1e-6) return dist2d(p, a);
	const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
	return dist2d(p, { x: a.x + t * abx, y: 0, z: a.z + t * abz });
}

/**
 * Estimated blocking radius for an object in the XZ plane.
 * Uses stored building dimensions if available, otherwise falls back to type defaults.
 */
function blockRadius(obj: SceneObject): number {
	const w = obj.metadata.buildingWidth;
	const d = obj.metadata.buildingDepth;
	if (typeof w === "number" && typeof d === "number") return Math.max(w, d) * 0.5;
	switch (obj.type) {
		case "building":
			return 6;
		case "wall":
			return 3;
		case "tree":
			return 1.5;
		default:
			return 2;
	}
}

// Types considered opaque obstacles
const OBSTACLE_TYPES = new Set(["building", "wall", "structure"]);

/**
 * Returns the name of the first obstacle found on the XZ segment from→to, or null.
 */
function firstObstacle(from: Vec3, to: Vec3, objects: SceneObject[]): string | null {
	// Skip the endpoints themselves (use a small exclusion radius)
	const totalDist = dist2d(from, to);
	if (totalDist < 0.5) return null;

	for (const obj of objects) {
		if (!OBSTACLE_TYPES.has(obj.type)) continue;
		const r = blockRadius(obj);
		// Object must be between from and to (not behind either end)
		const dFromA = dist2d(from, obj.position);
		const dFromB = dist2d(to, obj.position);
		if (dFromA < 1 || dFromB < 1) continue; // too close to an endpoint
		if (dFromA > totalDist + r || dFromB > totalDist + r) continue; // outside range
		if (pointToSegmentDist2d(obj.position, from, to) < r) return obj.name;
	}
	return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

const NEARBY_RADIUS = 20; // metres — objects beyond this are ignored

/**
 * Extract a scene caption from the object list.
 * Marble scenes store the AI-generated caption in the terrain/world object's description.
 * Returns undefined if no useful caption is found.
 */
export function extractSceneCaption(objects: SceneObject[]): string | undefined {
	const world = objects.find((o) => o.type === "terrain" && o.description && o.description.length > 10);
	return world?.description || undefined;
}

export function buildPerceptionContext(
	npcObj: SceneObject,
	allObjects: SceneObject[],
	playerPosition: Vec3 | undefined,
	environment: { timeOfDay?: string; weather?: string },
	sceneCaption?: string,
): string {
	const lines: string[] = [];

	// ── Scene caption (Marble / provider description) ────────────────────────
	if (sceneCaption) lines.push(`场景：${sceneCaption}`);

	// ── Environment ──────────────────────────────────────────────────────────
	const envParts: string[] = [];
	if (environment.timeOfDay) envParts.push(`时间：${environment.timeOfDay}`);
	if (environment.weather) envParts.push(`天气：${environment.weather}`);
	if (envParts.length > 0) lines.push(envParts.join("　"));

	// ── Self-position ────────────────────────────────────────────────────────
	const p = npcObj.position;
	lines.push(`你的位置：(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);

	// ── Player ───────────────────────────────────────────────────────────────
	if (playerPosition) {
		const d = dist2d(p, playerPosition);
		const dir = compassBearing(p, playerPosition);
		const blocker = firstObstacle(p, playerPosition, allObjects);
		const blockNote = blocker ? `（${blocker}在你们之间）` : "";
		lines.push(`玩家：${dir} ${d.toFixed(1)}米${blockNote}`);
	}

	// ── Partition nearby entities (excluding terrain/floor/sky/self) ─────────
	const others = allObjects
		.filter(
			(o) =>
				o.objectId !== npcObj.objectId &&
				o.type !== "terrain" &&
				o.type !== "floor" &&
				o.type !== "sky" &&
				o.type !== "road",
		)
		.map((o) => ({ o, d: dist2d(p, o.position) }))
		.filter(({ d }) => d <= NEARBY_RADIUS)
		.sort((a, b) => a.d - b.d);

	const nearbyNpcs = others.filter(({ o }) => o.type === "npc");
	const nearbyObjs = others.filter(({ o }) => o.type !== "npc").slice(0, 6);

	// ── Nearby NPCs ──────────────────────────────────────────────────────────
	if (nearbyNpcs.length > 0) {
		const parts = nearbyNpcs.map(({ o, d }) => {
			const dir = compassBearing(p, o.position);
			const blocker = firstObstacle(p, o.position, allObjects);
			const blockNote = blocker ? `[${blocker}阻挡]` : "";
			// Include short personality snippet so NPCs understand each other's roles
			const personality = typeof o.metadata?.npcPersonality === "string" ? o.metadata.npcPersonality : "";
			const roleNote = personality ? `，${personality.slice(0, 20)}` : "";
			// Include exact coords so the agent can call move_to() without an observe_scene() round-trip
			const coordNote = `，x=${o.position.x.toFixed(1)} z=${o.position.z.toFixed(1)}`;
			return `${o.name}（${dir} ${d.toFixed(1)}米${blockNote}${coordNote}${roleNote}，objectId=${o.objectId}）`;
		});
		lines.push(`附近NPC：${parts.join("、")}`);
	}

	// ── Nearby objects ───────────────────────────────────────────────────────
	if (nearbyObjs.length > 0) {
		const parts = nearbyObjs.map(({ o, d }) => {
			const dir = compassBearing(p, o.position);
			return `${o.name}[${o.type}]（${dir} ${d.toFixed(1)}米）`;
		});
		lines.push(`附近物件：${parts.join("、")}`);
	}

	return lines.join("\n");
}
