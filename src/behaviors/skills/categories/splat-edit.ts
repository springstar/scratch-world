import type { CategoryDef } from "./types.js";

export const splatEditCategory: CategoryDef = {
	name: "SPLAT_EDIT",

	detect: (code) => /new\s+SplatEdit\b/.test(code) || /world\.spark\.addEdit\s*\(/.test(code),

	// SplatEdit effects can be static (e.g. a persistent color zone) — no animate required
	skipAnimateCheck: true,

	invariants: [
		{
			test: (code) => !/if\s*\(\s*world\.spark\s*\)/.test(code),
			message: "SPLAT_EDIT must guard with `if (world.spark)` — spark is unavailable in non-splat scenes",
		},
		{
			test: (code) => !/world\.spark\.addEdit\s*\(/.test(code),
			message: "SPLAT_EDIT must call world.spark.addEdit(edit) to register the SplatEdit",
		},
	],
};
