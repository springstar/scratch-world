import { auroraEffect } from "./aurora.js";
import { fireEffect } from "./fire.js";
import { fireworksEffect } from "./fireworks.js";
import { lightningEffect } from "./lightning.js";
import { rainEffect } from "./rain.js";
import { snowEffect } from "./snow.js";
import { sparklesEffect } from "./sparkles.js";
import type { EffectDef } from "./types.js";
import { waterEffect } from "./water.js";

/** All registered effect definitions, checked in order. First match wins. */
const REGISTRY: EffectDef[] = [
	fireworksEffect,
	waterEffect,
	rainEffect,
	snowEffect,
	fireEffect,
	sparklesEffect,
	auroraEffect,
	lightningEffect,
];

/**
 * Find the best matching EffectDef for a user request, or null if none match.
 * Returns the first effect whose keywords regex matches the request.
 */
export function detectEffect(userRequest: string): EffectDef | null {
	return REGISTRY.find((e) => e.keywords.test(userRequest)) ?? null;
}
