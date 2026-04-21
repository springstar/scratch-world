import { particleCategory } from "./particle.js";
import { splatEditCategory } from "./splat-edit.js";
import { splatWeatherCategory } from "./splat-weather.js";
import type { CategoryDef } from "./types.js";

/**
 * Ordered registry of category definitions.
 * More specific detectors must come before more general ones.
 * First match wins for both detectFromRequest and detectCodeCategory.
 */
export const CATEGORY_REGISTRY: CategoryDef[] = [
	splatWeatherCategory, // before PARTICLE — snowBox is more specific than THREE.Points
	splatEditCategory,
	particleCategory,
];

/**
 * Find the CategoryDef matching the USER REQUEST (pre-generation).
 * Used to inject scene hints into the LLM prompt.
 */
export function detectCategoryFromRequest(userRequest: string): CategoryDef | null {
	return CATEGORY_REGISTRY.find((d) => d.detectFromRequest(userRequest)) ?? null;
}

/**
 * Find the CategoryDef that matches the GENERATED CODE (post-generation).
 * Used to run invariant checks.
 */
export function detectCodeCategory(code: string): CategoryDef | null {
	return CATEGORY_REGISTRY.find((d) => d.detect(code)) ?? null;
}
