import type { SceneObject } from "../types.js";

const PROXIMITY_RADIUS = 2.5; // metres

// ── Interactive prop proximity ────────────────────────────────────────────────

export interface NearbyInteractiveProp {
	objectId: string;
	name: string;
	skillName: string;
	skillConfig: Record<string, unknown>;
}

const PROP_APPROACH_RADIUS = 3.0; // metres — panel pops up
const PROP_LEAVE_RADIUS = 5.0; // metres — panel auto-dismisses

export { PROP_LEAVE_RADIUS };

/** Return the nearest prop with a skill attached within approach range, or null. */
export function findNearbyInteractiveProp(
	objects: SceneObject[],
	cx: number,
	cz: number,
	positionOverrides?: Map<string, { x: number; y: number; z: number }>,
): NearbyInteractiveProp | null {
	let closest: NearbyInteractiveProp | null = null;
	let closestDist2 = PROP_APPROACH_RADIUS * PROP_APPROACH_RADIUS;
	for (const obj of objects) {
		const skillMeta = obj.metadata?.skill as
			| { name: string; config: Record<string, unknown> }
			| undefined;
		if (!skillMeta || obj.type === "npc") continue;
		const pos = positionOverrides?.get(obj.objectId) ?? obj.position;
		const dx = cx - pos.x;
		const dz = cz - pos.z;
		const dist2 = dx * dx + dz * dz;
		if (dist2 < closestDist2) {
			closestDist2 = dist2;
			closest = {
				objectId: obj.objectId,
				name: obj.name,
				skillName: skillMeta.name,
				skillConfig: skillMeta.config ?? {},
			};
		}
	}
	return closest;
}

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
