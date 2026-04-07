import type { SceneObject } from "../types.js";

const PROXIMITY_RADIUS = 2.5; // metres

export interface NearbyNpc {
  objectId: string;
  name: string;
  interactionHint?: string;
}

/** Pre-filter to only interactable NPCs once. */
export function extractNpcs(objects: SceneObject[]): SceneObject[] {
  return objects.filter(
    (o) => o.type === "npc" && (o.interactable || typeof o.metadata?.npcPersonality === "string"),
  );
}

/** Return the nearest NPC within proximity range, or null.
 *  positionOverrides: resolved world positions keyed by objectId, used instead of
 *  SceneObject.position when available (SceneObject positions start at {0,0,0}).
 */
export function findNearbyNpc(
  npcs: SceneObject[],
  cx: number,
  cy: number,
  cz: number,
  positionOverrides?: Map<string, { x: number; y: number; z: number }>,
): NearbyNpc | null {
  let closest: NearbyNpc | null = null;
  let closestDist2 = PROXIMITY_RADIUS * PROXIMITY_RADIUS;

  for (const npc of npcs) {
    const pos = positionOverrides?.get(npc.objectId) ?? npc.position;
    const dx = cx - pos.x;
    const dy = cy - (pos.y + 1); // approx NPC torso height
    const dz = cz - pos.z;
    const dist2 = dx * dx + dy * dy + dz * dz;
    if (dist2 < closestDist2) {
      closestDist2 = dist2;
      closest = {
        objectId: npc.objectId,
        name: npc.name,
        interactionHint: npc.interactionHint,
      };
    }
  }

  return closest;
}
