/**
 * CategoryDef — validation rules for a generated code category.
 *
 * reviewGeneratedCode iterates CATEGORY_REGISTRY; each CategoryDef owns its
 * detection logic and invariants. Adding a new category = new file here,
 * not a new if/else block in reviewGeneratedCode.
 */
export interface CategoryDef {
	/** Short identifier used in log messages. */
	name: string;

	/**
	 * Detect whether generated code belongs to this category.
	 * Called against the generated code string (not the user request).
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
