import RAPIER from "@dimforge/rapier3d-compat";
import type { Viewpoint } from "../types.js";

export type PlacementHint = "near_camera" | "near_entrance" | "scene_center";

export interface ResolvedPosition {
  x: number;
  y: number;
  z: number;
}

// Minimum separation between placed props (metres)
const MIN_SEP = 1.5;

// Pre-computed slot offsets from the anchor (x, z relative)
// Arc in front of anchor: near row then mid row
const SLOTS: Array<[number, number]> = [
  [0, 3],
  [-1.5, 3.5],
  [1.5, 3.5],
  [0, 5],
  [-2.5, 5],
  [2.5, 5],
  [-1.2, 6.5],
  [1.2, 6.5],
  [0, 7],
  [-3, 4],
  [3, 4],
];

/**
 * Cast a ray straight down from (x, startY, z) and return the ground Y.
 * Falls back to fallbackY if nothing is hit.
 */
function groundY(
  world: InstanceType<typeof RAPIER.World>,
  x: number,
  z: number,
  startY = 10,
  fallbackY = 0,
): number {
  const ray = new RAPIER.Ray({ x, y: startY, z }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(ray, 30, true);
  return hit ? startY - hit.timeOfImpact : fallbackY;
}

function tooClose(
  x: number,
  z: number,
  occupied: ResolvedPosition[],
): boolean {
  const minSq = MIN_SEP * MIN_SEP;
  for (const o of occupied) {
    const dx = o.x - x;
    const dz = o.z - z;
    if (dx * dx + dz * dz < minSq) return true;
  }
  return false;
}

/**
 * Resolve a world position for a prop.
 *
 * @param hint   - "near_camera" | "near_entrance" | "scene_center" (default: "near_camera")
 * @param world  - Rapier world (already has collision mesh loaded)
 * @param occupied - positions already taken by earlier props
 * @param viewpoints - viewpoints from SceneData (used for near_entrance)
 * @param index  - prop index (fallback spiral offset when slots exhausted)
 */
export function resolvePosition(
  hint: PlacementHint | undefined,
  world: InstanceType<typeof RAPIER.World>,
  occupied: ResolvedPosition[],
  viewpoints: Viewpoint[],
  index: number,
): ResolvedPosition {
  // Determine anchor from hint
  let ax = 0;
  let az = 0;

  if (hint === "near_entrance" && viewpoints.length > 0) {
    const vp = viewpoints[0];
    ax = vp.position.x;
    az = vp.position.z;
  } else if (hint === "scene_center") {
    ax = 0;
    az = 0;
  }
  // "near_camera" and default: anchor stays at (0, 0) — camera starts there

  // Try pre-computed arc slots
  for (const [dx, dz] of SLOTS) {
    const cx = ax + dx;
    const cz = az + dz;
    if (!tooClose(cx, cz, occupied)) {
      const y = groundY(world, cx, cz);
      return { x: cx, y, z: cz };
    }
  }

  // Slots exhausted — golden-angle spiral fallback
  const phi = 2.399963;
  for (let i = 0; i < 40; i++) {
    const r = 3 + Math.sqrt((index + i + 0.5) / 40) * 8;
    const theta = (index + i) * phi;
    const cx = ax + r * Math.cos(theta);
    const cz = az + r * Math.sin(theta);
    if (!tooClose(cx, cz, occupied)) {
      const y = groundY(world, cx, cz);
      return { x: cx, y, z: cz };
    }
  }

  // Final fallback: linear offset in +X
  const cx = ax + 3 + index * MIN_SEP;
  const y = groundY(world, cx, az);
  return { x: cx, y, z: az };
}
