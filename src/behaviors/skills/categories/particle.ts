import type { CategoryDef } from "./types.js";

export const particleCategory: CategoryDef = {
	name: "PARTICLE",

	detect: (code) => /world\.THREE\.Points\b/.test(code) || /new\s+THREE\.Points\b/.test(code),

	invariants: [
		{
			test: (code) => !/world\.THREE\.Points\b/.test(code) && !/new\s+THREE\.Points\b/.test(code),
			message: "PARTICLE effect must use THREE.Points, not Mesh spheres",
		},
		{
			test: (code) => !/AdditiveBlending/.test(code),
			message: "PARTICLE effect must set AdditiveBlending on material",
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
