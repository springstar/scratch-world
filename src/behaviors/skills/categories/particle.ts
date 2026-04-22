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

	platformHints: () => [
		"Platform has Spark 2.0 (world.spark). For PARTICLE effects, consider layering SplatEdit to enhance scene immersion:",
		"• Explosion/burst: add an ADD_RGBA SplatEditSdf sphere at the burst origin, animate radius 0→8 then collapse in 0.3s — this illuminates scene geometry (ground, trees) with burst color, making the effect interact with the environment",
		"• Fire/smoke: add a SET_RGB cylindrical SplatEdit above the source to tint the background with heat haze color",
		"• Long-lived effects (snow, rain): SplatEdit is NOT needed — overhead cost not worth it for ambient loops",
		"SplatEdit pattern (always guard with if (world.spark)): const edit = new world.spark.Spark.SplatEdit({ rgbaBlendMode: world.spark.Spark.SplatEditRgbaBlendMode.ADD_RGBA, softEdge: 0.4 }); edit.addSdf(new world.spark.Spark.SplatEditSdf({ type: world.spark.Spark.SplatEditSdfType.SPHERE, radius: 0, opacity: 0.9, color: new world.THREE.Color(r, g, b) })); world.spark.addEdit(edit);",
	],

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
			test: (code) => !/depthTest\s*:\s*false/.test(code),
			message:
				"PARTICLE effect must set depthTest: false on material — Gaussian Splat depth buffer occludes particles " +
				"even at higher renderOrder unless depthTest is disabled",
		},
		{
			test: (code) => /new\s+(?:world\.)?THREE\.Points\s*\(/.test(code) && !/frustumCulled\s*=\s*false/.test(code),
			message:
				"THREE.Points must set .frustumCulled = false — particles initialized at y=-9999 bake a bounding sphere " +
				"at that position; frustum culling then permanently discards the geometry even after positions are updated",
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
