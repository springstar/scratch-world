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
	 * Structural invariants that MUST be satisfied in generated code.
	 * Each entry is a { test, message } pair — test returns true when the invariant is VIOLATED.
	 * Failed invariants trigger a retry with the message as feedback.
	 */
	invariants: Array<{
		test: (code: string) => boolean;
		message: string;
	}>;

	/**
	 * Reference implementation injected into the system prompt.
	 * This is knowledge, not a template — LLM should understand the design intent
	 * and produce its own implementation that satisfies the invariants.
	 */
	referenceImpl: string;

	/**
	 * One-paragraph description of design intent injected into the system prompt
	 * before the reference implementation.
	 */
	designIntent: string;
}
