import type { CategoryDef } from "./types.js";

export const splatWeatherCategory: CategoryDef = {
	name: "SPLAT_WEATHER",

	detect: (code) => /world\.spark\.Spark\.snowBox\b/.test(code) && /world\.spark\.addSplat\s*\(/.test(code),

	// snowBox manages its own render loop via the splat system
	skipAnimateCheck: true,

	invariants: [
		{
			test: (code) => !/if\s*\(\s*world\.spark\s*\)/.test(code),
			message: "SPLAT_WEATHER must guard with `if (world.spark)` — spark is unavailable in non-splat scenes",
		},
		{
			test: (code) => !/world\.spark\.addSplat\s*\(/.test(code),
			message: "SPLAT_WEATHER must call world.spark.addSplat() to register the particle system",
		},
	],
};
