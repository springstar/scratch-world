import { fireworksEffect } from "./fireworks.js";
import type { EffectDef } from "./types.js";

/** All registered effect definitions, checked in order. First match wins. */
const REGISTRY: EffectDef[] = [fireworksEffect];

/**
 * Find the best matching EffectDef for a user request, or null if none match.
 * Returns the first effect whose keywords regex matches the request.
 */
export function detectEffect(userRequest: string): EffectDef | null {
	return REGISTRY.find((e) => e.keywords.test(userRequest)) ?? null;
}
