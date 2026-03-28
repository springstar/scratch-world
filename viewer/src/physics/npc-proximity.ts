import type { SceneObject } from "../types.js";

const PROXIMITY_RADIUS = 2.5; // metres

export interface NearbyNpc {
  objectId: string;
  name: string;
  interactionHint?: string;
}

/** Pre-filter to only interactable NPCs once. */
export function extractNpcs(objects: SceneObject[]): SceneObject[] {
  return objects.filter((o) => o.type === "npc" && o.interactable);
}

/** Return the nearest NPC within proximity range, or null. */
export function findNearbyNpc(
  npcs: SceneObject[],
  cx: number,
  cy: number,
  cz: number,
): NearbyNpc | null {
  let closest: NearbyNpc | null = null;
  let closestDist2 = PROXIMITY_RADIUS * PROXIMITY_RADIUS;

  for (const npc of npcs) {
    const dx = cx - npc.position.x;
    const dy = cy - (npc.position.y + 1); // approx NPC torso height
    const dz = cz - npc.position.z;
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
