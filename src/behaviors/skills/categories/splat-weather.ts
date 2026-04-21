import type { CategoryDef } from "./types.js";

export const splatWeatherCategory: CategoryDef = {
	name: "SPLAT_WEATHER",

	detectFromRequest: (req) => /snowfall|blizzard|drizzle|heavy rain|splat.*weather/i.test(req),

	sceneHints: (env) => {
		const hints: string[] = [];
		const isNight = /night|evening|dusk|midnight/i.test(`${env.timeOfDay ?? ""} ${env.skybox ?? ""}`);

		hints.push("SPLAT_WEATHER uses world.spark.Spark.snowBox — always guard with `if (world.spark)`.");

		if (isNight) {
			hints.push(
				"Scene is NIGHTTIME — use brighter, slightly blue-tinted snow colors (0.85–0.95 white). " +
					"Increase opacity (0.8–0.9) for visibility against dark sky.",
			);
		} else {
			hints.push(
				"Scene is DAYTIME — use slightly warm white snow colors (0.9, 0.92, 0.95). " +
					"Lower opacity (0.5–0.7) to blend naturally with ambient light.",
			);
		}

		const weather = env.weather ?? "";
		if (/storm|heavy|blizzard/i.test(weather)) {
			hints.push(
				"Heavy weather detected — use high density (0.008–0.015) and faster fallVelocity (8–12 for rain, 2–3 for blizzard).",
			);
		}

		return hints;
	},

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
