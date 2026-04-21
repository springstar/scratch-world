import type { EnvironmentConfig } from "../../../scene/types.js";

/**
 * CategoryDef — rendering knowledge for a generated code category.
 *
 * Owns three responsibilities:
 *   1. detectFromRequest — match user intent to category (pre-generation)
 *   2. sceneHints        — inject scene-aware rendering rules into LLM prompt
 *   3. detect + invariants — validate generated code (post-generation)
 *
 * Adding a new category = new file here, not changes to code-gen.ts.
 */
export interface CategoryDef {
	/** Short identifier used in log messages and system prompt injection. */
	name: string;

	/**
	 * Detect whether the USER REQUEST belongs to this category.
	 * Used before generation to select scene hints for the LLM prompt.
	 * First match in registry wins.
	 */
	detectFromRequest: (userRequest: string) => boolean;

	/**
	 * Scene-aware rendering rules injected into the LLM system prompt.
	 * Called with the actual scene environment; returns an array of directive
	 * strings that tell the LLM how to adapt this category for the scene.
	 * Return [] when no adaptation is needed.
	 */
	sceneHints: (env: EnvironmentConfig) => string[];

	/**
	 * Detect whether GENERATED CODE belongs to this category.
	 * Called post-generation for invariant checking.
	 * First match in registry wins.
	 */
	detect: (code: string) => boolean;

	/**
	 * When true, skip the universal world.animate() check for this category.
	 * Use for effects whose animation loop is managed outside world.animate()
	 * (e.g. Spark splat systems handle their own render loop).
	 */
	skipAnimateCheck?: boolean;

	/**
	 * Structural invariants that MUST be satisfied in generated code.
	 * test returns true when the invariant is VIOLATED.
	 * Failed invariants are fed back to the LLM as retry feedback.
	 */
	invariants: Array<{
		test: (code: string) => boolean;
		message: string;
	}>;
}
