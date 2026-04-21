import type { CategoryDef } from "./types.js";

export const particleCategory: CategoryDef = {
	name: "PARTICLE",

	detectFromRequest: (req) =>
		/firework|snow|rain|fire|smoke|spark|explosion|confetti|magic|particle|烟花|雪|烟/i.test(req),

	sceneHints: (env) => {
		const hints: string[] = [];
		const isNight = /night|evening|dusk|midnight/i.test(`${env.timeOfDay ?? ""} ${env.skybox ?? ""}`);
		const isIndoor = /indoor|interior|room|hall|arena/i.test(env.skybox ?? "");

		if (isNight) {
			hints.push(
				"Scene is NIGHTTIME — use blending: world.THREE.AdditiveBlending for particles. " +
					"Additive blending creates vivid glowing effects against dark sky. " +
					"Particle size can be smaller (0.8–2.0) since colors pop without competition from daylight.",
			);
		} else if (!isIndoor) {
			hints.push(
				"Scene is DAYTIME OUTDOORS with bright sky — use blending: world.THREE.NormalBlending for burst/explosion particles. " +
					"AdditiveBlending washes out against bright backgrounds, making particles invisible. " +
					"Increase particle size (2.5–4.0) so they remain visible at camera distance.",
			);
		}

		if (isIndoor) {
			hints.push(
				"Scene is INDOOR — keep effects contained: reduce altitude (max 5–8 units), " +
					"tighter spread radius (max 6 units), smaller particle size (1.5–2.5). " +
					"Use NormalBlending for visibility against interior lighting.",
			);
		}

		return hints;
	},

	detect: (code) => /world\.THREE\.Points\b/.test(code) || /new\s+THREE\.Points\b/.test(code),

	invariants: [
		{
			test: (code) => !/world\.THREE\.Points\b/.test(code) && !/new\s+THREE\.Points\b/.test(code),
			message: "PARTICLE effect must use THREE.Points, not Mesh spheres",
		},
		{
			test: (code) => !/AdditiveBlending/.test(code) && !/NormalBlending/.test(code),
			message:
				"PARTICLE effect must set an explicit blending mode (AdditiveBlending for night/dark scenes, NormalBlending for daytime/bright scenes)",
		},
		{
			test: (code) => !/depthWrite\s*:\s*false/.test(code),
			message: "PARTICLE effect must set depthWrite: false on material",
		},
		{
			test: (code) => {
				const m = code.match(/(?:TOTAL|COUNT|count|total)\s*[=*]\s*(\d+)|new Float32Array\((\d+)\s*\*\s*3\)/);
				if (!m) return false;
				const count = Number(m[1] ?? m[2]);
				return !Number.isNaN(count) && count < 100;
			},
			message: "PARTICLE count too low — minimum 200 for ambient effects, 500 for explosions/fireworks",
		},
	],
};
