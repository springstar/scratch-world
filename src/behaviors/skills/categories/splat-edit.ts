import type { CategoryDef } from "./types.js";

export const splatEditCategory: CategoryDef = {
	name: "SPLAT_EDIT",

	detectFromRequest: (req) => /ripple|shockwave|warp|deform|colorize|burn.*zone|splat.*edit/i.test(req),

	sceneHints: (env) => {
		const hints: string[] = [];
		const isNight = /night|evening|dusk|midnight/i.test(`${env.timeOfDay ?? ""} ${env.skybox ?? ""}`);

		hints.push("SPLAT_EDIT modifies the Gaussian Splat scene background — always guard with `if (world.spark)`.");

		if (isNight) {
			hints.push(
				"Scene is NIGHTTIME — prefer ADD_RGBA blend mode for glowing edits (fire, portals, magic zones). " +
					"SET_RGB works well for recoloring large areas.",
			);
		} else {
			hints.push(
				"Scene is DAYTIME — SET_RGB blend mode is most visible for color changes. " +
					"ADD_RGBA for glowing effects but keep opacity low (0.3–0.6) to avoid overexposure.",
			);
		}

		return hints;
	},

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
