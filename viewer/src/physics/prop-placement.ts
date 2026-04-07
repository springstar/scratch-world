import RAPIER from "@dimforge/rapier3d-compat";
import type { Viewpoint } from "../types.js";

export type PlacementHint = "near_camera" | "near_entrance" | "scene_center" | "exact";

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
 * startY should be just above the player so the ray originates inside the room,
 * not above the ceiling (which would give the ceiling top face as the "ground").
 * Falls back to fallbackY if nothing is hit.
 */
function groundY(
  world: InstanceType<typeof RAPIER.World>,
  x: number,
  z: number,
  startY = 2,
  fallbackY = 0,
): number {
  const ray = new RAPIER.Ray({ x, y: startY, z }, { x: 0, y: -1, z: 0 });
  // solid=false: if the ray origin is at or just inside the surface (floating-point
  // edge case), don't return TOI=0 — find the next surface below instead.
  const hit = world.castRay(ray, 30, false);
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
 * @param hint          - "near_camera" | "near_entrance" | "scene_center" (default: "near_camera")
 * @param world         - Rapier world (already has collision mesh loaded)
 * @param occupied      - positions already taken by earlier props
 * @param viewpoints    - viewpoints from SceneData (used for near_entrance)
 * @param index         - prop index (fallback spiral offset when slots exhausted)
 * @param playerPosition - player's world position when the request was made (used as near_camera anchor)
 */
export function resolvePosition(
  hint: PlacementHint | undefined,
  world: InstanceType<typeof RAPIER.World>,
  occupied: ResolvedPosition[],
  viewpoints: Viewpoint[],
  index: number,
  playerPosition?: { x: number; y: number; z: number },
  splatGroundOffset?: number,
): ResolvedPosition {
  // Determine anchor from hint
  let ax = 0;
  let az = 0;
  // fallbackY when raycast misses entirely: use -ground_plane_offset (Marble coordinate
  // flip gives floor at -offset in Three.js space) or 0 for non-Marble scenes.
  const fallbackY = splatGroundOffset !== undefined ? -splatGroundOffset : 0;
  // Ray origin: start 2 m above the known splat floor level so the ray is always
  // inside the room, not above the ceiling. Using playerPosition.y + 2 is unsafe
  // for indoor scenes with low ceilings because the body centre already sits ~1.6 m
  // above the floor, putting the origin above a 3 m ceiling.
  const rayStartY = fallbackY + 2;

  // "exact": place at the provided x/z directly — used when the user clicked a
  // specific point in the scene. The click position is already a Rapier surface hit,
  // so use its Y directly without re-raycasting (a second raycast risks hitting a
  // ceiling if the start height overshoots).
  if (hint === "exact" && playerPosition) {
    return { x: playerPosition.x, y: playerPosition.y, z: playerPosition.z };
  }

  if (hint === "near_entrance" && viewpoints.length > 0) {
    const vp = viewpoints[0];
    ax = vp.position.x;
    az = vp.position.z;
  } else if (hint === "scene_center") {
    ax = 0;
    az = 0;
  } else if (playerPosition) {
    // near_camera (default): use the player's actual position at request time
    ax = playerPosition.x;
    az = playerPosition.z;
  }
  // fallback if no playerPosition: anchor stays at (0, 0)

  // Try pre-computed arc slots
  for (const [dx, dz] of SLOTS) {
    const cx = ax + dx;
    const cz = az + dz;
    if (!tooClose(cx, cz, occupied)) {
      const y = groundY(world, cx, cz, rayStartY, fallbackY);
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
      const y = groundY(world, cx, cz, rayStartY, fallbackY);
      return { x: cx, y, z: cz };
    }
  }

  // Final fallback: linear offset in +X
  const cx = ax + 3 + index * MIN_SEP;
  const y = groundY(world, cx, az, rayStartY, fallbackY);
  return { x: cx, y, z: az };
}
