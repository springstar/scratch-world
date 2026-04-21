import type { EnvironmentConfig } from "../../../scene/types.js";

/**
 * EffectDef — knowledge unit for a specific visual effect type.
 *
 * code-gen.ts is the execution framework; EffectDef is the effect-specific knowledge.
 * Adding a new effect = adding a file here, not changing code-gen.ts.
 */
export interface EffectDef {
	/** Regex that matches user requests for this effect. */
	keywords: RegExp;

	/**
	 * When true, skip LLM code generation entirely and use referenceImpl (or adaptImpl output) directly.
	 * Use for effects where the reference implementation is authoritative and LLM
	 * rewriting reliably produces inferior results.
	 */
	useReferenceDirectly?: boolean;

	/**
	 * Optional scene-aware adaptation of the reference implementation.
	 * Called instead of returning referenceImpl verbatim when useReferenceDirectly is true.
	 * Use to adjust blending modes, particle sizes, altitudes etc. for day/night/indoor/weather.
	 * If absent, referenceImpl is returned as-is.
	 */
	adaptImpl?: (base: string, env: EnvironmentConfig) => string;

	/**
	 * Structural invariants that MUST be satisfied in generated code.
	 * Each entry is a { test, message } pair — test returns true when the invariant is VIOLATED.
	 * Failed invariants trigger a retry with the message as feedback.
	 * Ignored when useReferenceDirectly is true.
	 */
	invariants: Array<{
		test: (code: string) => boolean;
		message: string;
	}>;

	/**
	 * Reference implementation injected into the system prompt.
	 * When useReferenceDirectly is true, used as the base passed to adaptImpl (or verbatim if no adaptImpl).
	 * Otherwise injected as knowledge — LLM should understand the design intent
	 * and produce its own implementation that satisfies the invariants.
	 */
	referenceImpl: string;

	/**
	 * One-paragraph description of design intent injected into the system prompt
	 * before the reference implementation.
	 */
	designIntent: string;
}
