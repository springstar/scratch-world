import RAPIER from "@dimforge/rapier3d-compat";
import type { Viewpoint } from "../types.js";

export type PlacementHint = "near_camera" | "near_entrance" | "scene_center" | "exact" | "fixed";

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
  // Try solid=true first (handles ray origin inside terrain mesh)
  const ray = new RAPIER.Ray({ x, y: startY, z }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(ray, startY - fallbackY + 5, true);
  if (hit && hit.timeOfImpact > 0.01) return startY - hit.timeOfImpact;
  // Fallback: solid=false in case of false-positive solid hit at origin
  const hit2 = world.castRay(ray, startY - fallbackY + 5, false);
  if (hit2) return startY - hit2.timeOfImpact;
  return fallbackY;
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
 * @param splatGroundOffset - Marble ground plane offset for fallback Y
 * @param cameraForward - normalised XZ forward vector of the camera at placement time
 */
export function resolvePosition(
  hint: PlacementHint | undefined,
  world: InstanceType<typeof RAPIER.World>,
  occupied: ResolvedPosition[],
  viewpoints: Viewpoint[],
  index: number,
  playerPosition?: { x: number; y: number; z: number },
  splatGroundOffset?: number,
  cameraForward?: { x: number; z: number },
): ResolvedPosition {
  // Determine anchor from hint
  let ax = 0;
  let az = 0;
  // fallbackY when raycast misses entirely: use -ground_plane_offset (Marble coordinate
  // flip gives floor at -offset in Three.js space) or 0 for non-Marble scenes.
  const fallbackY = splatGroundOffset !== undefined ? -splatGroundOffset : 0;
  // Ray origin for non-exact placement: 2 m above the nominal floor so the ray is
  // always inside the room, not above the ceiling.
  const rayStartY = fallbackY + 2;

  // "fixed": use the stored XYZ exactly as-is — no Rapier raycast, no terrain snapping.
  // Use for wall-mounted objects (TVs, paintings, shelves) where Y must not be overridden.
  if (hint === "fixed" && playerPosition) {
    return { x: playerPosition.x, y: playerPosition.y, z: playerPosition.z };
  }

  // "exact": use the stored XZ as-is, but still raycast to find the real terrain Y.
  // The stored Y comes from the position picker (panorama-formula estimate) which is
  // approximate and does not account for actual terrain elevation.
  // Start the ray well above the terrain (10 m above nominal floor) to ensure the ray
  // originates above elevated terrain like garden paths, ramps, or raised platforms.
  if (hint === "exact" && playerPosition) {
    // Trust the client's Y directly — it comes from the ghost's ground-plane intersection
    // which is more accurate than a server-side raycast on open terrain with no colliders.
    // Only use our own raycast as a tiebreaker if the client Y equals the raw fallback
    // (meaning the client also had no better information).
    const exactRayStart = fallbackY + 10;
    const terrainY = groundY(world, playerPosition.x, playerPosition.z, exactRayStart, fallbackY);
    const resolvedY = terrainY !== fallbackY ? terrainY : playerPosition.y;
    console.log(`[placement] exact hint: xz=(${playerPosition.x.toFixed(2)},${playerPosition.z.toFixed(2)}) clientY=${playerPosition.y.toFixed(3)} terrainY=${terrainY.toFixed(3)} resolvedY=${resolvedY.toFixed(3)}`);
    return { x: playerPosition.x, y: resolvedY, z: playerPosition.z };
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

  // Compute camera yaw rotation matrix components so SLOTS arc in front of the player.
  // SLOTS are defined relative to a camera facing -Z (Three.js default forward).
  // If cameraForward is provided, rotate each slot by the camera's yaw angle.
  // cos/sin for rotation: fwd = (fx, fz), right = (fz, -fx)
  let cosY = 1;
  let sinY = 0;
  if (cameraForward) {
    // cameraForward is already normalised; fwd.z is the -Z component in world space.
    // We want the rotation that maps (0, -1) → (fx, fz).
    // That rotation has: cosY = -fz, sinY = -fx (rotate from -Z to fwd).
    cosY = -cameraForward.z;
    sinY = -cameraForward.x;
  }

  const rotateSlot = (dx: number, dz: number): [number, number] => [
    dx * cosY - dz * sinY,
    dx * sinY + dz * cosY,
  ];

  // Try pre-computed arc slots (rotated to face the camera's forward direction)
  for (const [dx, dz] of SLOTS) {
    const [rdx, rdz] = rotateSlot(dx, dz);
    const cx = ax + rdx;
    const cz = az + rdz;
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
