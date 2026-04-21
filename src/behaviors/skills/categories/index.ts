import { particleCategory } from "./particle.js";
import { splatEditCategory } from "./splat-edit.js";
import { splatWeatherCategory } from "./splat-weather.js";
import type { CategoryDef } from "./types.js";

/**
 * Ordered registry of category definitions, checked against generated code.
 * More specific detectors must come before more general ones.
 * First match wins; unmatched code skips category-specific invariants.
 */
export const CATEGORY_REGISTRY: CategoryDef[] = [
	splatWeatherCategory, // before PARTICLE — snowBox is more specific than THREE.Points
	splatEditCategory,
	particleCategory,
];

/**
 * Find the CategoryDef that matches the generated code, or null if none match.
 */
export function detectCodeCategory(code: string): CategoryDef | null {
	return CATEGORY_REGISTRY.find((d) => d.detect(code)) ?? null;
}
