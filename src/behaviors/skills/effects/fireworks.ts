import type { EffectDef } from "./types.js";

export const fireworksEffect: EffectDef = {
	keywords: /firework|fireworks|烟花/i,

	// Reference implementation is authoritative — LLM rewrites consistently produce
	// fewer particles, washed-out colors, and missing rocket-phase mechanics.
	useReferenceDirectly: true,

	designIntent: `
Fireworks are a two-phase effect: a fast-rising rocket streak, then an explosion burst at peak height.
The key insight is that burst particles must be SPAWNED at the rocket's position when it peaks — they
must not exist before the explosion. Two separate THREE.Points systems are required (rockets + burst pool).
Rockets rise fast (vy ≥ 14 units/s, ~0.5s ascent), then trigger explode() which copies rocket position
into burst particle positions and sets sphere-spread velocities. Burst particles use vertexColors with
a vivid palette — white particles are invisible in daylit scenes. Gravity applies to both systems.
`.trim(),

	referenceImpl: `\
// Fireworks — two-phase: rocket ascent then explosion burst at peak
const THREE = world.THREE;
const OX = objectPosition.x, OZ = objectPosition.z, OY = objectPosition.y ?? 0;

const sparkTex = new THREE.TextureLoader().load('/assets/particles/spark1.png');
const glowTex  = new THREE.TextureLoader().load('/assets/particles/lensflare0.png');

const ROCKET_COUNT = 6;
const BURST_PER    = 400;

// ── Rockets ──────────────────────────────────────────────────────────────────
const rocketGeo = new THREE.BufferGeometry();
const rPos  = new Float32Array(ROCKET_COUNT * 3);
const rVel  = new Float32Array(ROCKET_COUNT * 3);
const rLife = new Float32Array(ROCKET_COUNT);
// Hide all rockets off-screen until they launch
for (let r = 0; r < ROCKET_COUNT; r++) rPos[r*3+1] = -9999;
rocketGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
const rockets = new THREE.Points(rocketGeo, new THREE.PointsMaterial({
  map: glowTex, size: 1.5, sizeAttenuation: true,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  color: 0xffdd88,
}));
rockets.renderOrder = 3;
world.scene.add(rockets);

// ── Burst pool ────────────────────────────────────────────────────────────────
const BTOTAL = ROCKET_COUNT * BURST_PER;
const bGeo  = new THREE.BufferGeometry();
const bPos  = new Float32Array(BTOTAL * 3);
const bVel  = new Float32Array(BTOTAL * 3);
const bLife = new Float32Array(BTOTAL);
const bMaxL = new Float32Array(BTOTAL);
const bCol  = new Float32Array(BTOTAL * 3);
const bBase = new Float32Array(BTOTAL * 3);
bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
bGeo.setAttribute('color',    new THREE.BufferAttribute(bCol, 3));
// NormalBlending: burst particles are opaque, visible against bright daylit sky
const burst = new THREE.Points(bGeo, new THREE.PointsMaterial({
  map: sparkTex, size: 3.5, sizeAttenuation: true,
  transparent: true, depthWrite: false,
  blending: THREE.NormalBlending, vertexColors: true,
}));
burst.renderOrder = 2;
world.scene.add(burst);
for (let i = 0; i < BTOTAL; i++) bPos[i*3+1] = -9999;

const palette = [
  [1.0, 0.10, 0.05], [1.0, 0.80, 0.00], [0.05, 0.35, 1.0],
  [1.0, 0.05, 0.80], [0.05, 1.0,  0.25], [1.0, 0.40, 0.0],
];

function launchRocket(r) {
  rPos[r*3]   = OX + (Math.random() - 0.5) * 12;
  rPos[r*3+1] = OY + 0.5;
  rPos[r*3+2] = OZ + (Math.random() - 0.5) * 12;
  rVel[r*3+1] = 18 + Math.random() * 6;
  // Fixed flight time ~1s — ensures rockets reach 15-20 units altitude regardless of velocity
  rLife[r]    = 0.85 + Math.random() * 0.35;
}

// CRITICAL: burst particles spawned at rocket's current position when it peaks
function explode(r) {
  const ex = rPos[r*3], ey = rPos[r*3+1], ez = rPos[r*3+2];
  const col = palette[r % palette.length];
  for (let i = 0; i < BURST_PER; i++) {
    const idx  = r * BURST_PER + i;
    const phi  = Math.acos(2 * Math.random() - 1);
    const th   = Math.random() * Math.PI * 2;
    const spd  = 6 + Math.random() * 9;
    bVel[idx*3]   = Math.sin(phi) * Math.cos(th) * spd;
    bVel[idx*3+1] = Math.cos(phi) * spd;
    bVel[idx*3+2] = Math.sin(phi) * Math.sin(th) * spd;
    bPos[idx*3]   = ex; bPos[idx*3+1] = ey; bPos[idx*3+2] = ez;
    const life = 1.8 + Math.random() * 1.2;
    bLife[idx] = life; bMaxL[idx] = life;
    bBase[idx*3]   = col[0] * (0.85 + Math.random() * 0.15);
    bBase[idx*3+1] = col[1] * (0.85 + Math.random() * 0.15);
    bBase[idx*3+2] = col[2] * (0.85 + Math.random() * 0.15);
    bCol[idx*3]   = bBase[idx*3];
    bCol[idx*3+1] = bBase[idx*3+1];
    bCol[idx*3+2] = bBase[idx*3+2];
  }
  rPos[r*3+1] = -9999;
}

const launchAt = Array.from({length: ROCKET_COUNT}, (_, i) => i * 0.9);
const exploded = new Array(ROCKET_COUNT).fill(true);
let elapsed = 0;

world.animate((dt) => {
  elapsed += dt;
  const G = -9.8;
  for (let r = 0; r < ROCKET_COUNT; r++) {
    if (elapsed >= launchAt[r] && exploded[r]) { launchRocket(r); exploded[r] = false; }
  }
  for (let r = 0; r < ROCKET_COUNT; r++) {
    if (exploded[r]) continue;
    rLife[r] -= dt;
    rVel[r*3+1] += G * dt * 0.25;
    rPos[r*3+1] += rVel[r*3+1] * dt;
    if (rLife[r] <= 0) { explode(r); exploded[r] = true; }
  }
  rocketGeo.attributes.position.needsUpdate = true;
  for (let i = 0; i < BTOTAL; i++) {
    if (bLife[i] <= 0) { bPos[i*3+1] = -9999; continue; }
    bLife[i] -= dt;
    bVel[i*3+1] += G * dt;
    bPos[i*3]   += bVel[i*3]   * dt;
    bPos[i*3+1] += bVel[i*3+1] * dt;
    bPos[i*3+2] += bVel[i*3+2] * dt;
    // Linear fade using stored base color — framerate-independent
    const t = Math.max(0, bLife[i] / bMaxL[i]);
    bCol[i*3]   = bBase[i*3]   * t;
    bCol[i*3+1] = bBase[i*3+1] * t;
    bCol[i*3+2] = bBase[i*3+2] * t;
  }
  bGeo.attributes.position.needsUpdate = true;
  bGeo.attributes.color.needsUpdate    = true;
  if (elapsed > launchAt[ROCKET_COUNT-1] + 6.0) {
    elapsed = 0;
    for (let r = 0; r < ROCKET_COUNT; r++) { exploded[r] = true; launchAt[r] = r * 0.9 + Math.random() * 0.4; }
    for (let i = 0; i < BTOTAL; i++) bLife[i] = 0;
  }
});`,

	invariants: [
		{
			test: (code) => (code.match(/new\s+(?:world\.)?THREE\.Points\s*\(/g) ?? []).length < 2,
			message:
				"Fireworks require TWO separate THREE.Points systems: one for rising rocket streaks, one for explosion burst particles. " +
				"Found fewer than 2. The rocket Points shows the ascent; the burst Points shows the explosion.",
		},
		{
			test: (code) => {
				const m = code.match(/rVel\[.*?\]\s*=\s*([\d.]+)|vy\s*=\s*([\d.]+)/);
				if (!m) return true; // no velocity found → violation
				const v = Number(m[1] ?? m[2]);
				return !Number.isNaN(v) && v < 14;
			},
			message:
				"Rocket upward velocity must be ≥ 14 units/s for a realistic fast ascent (~0.5s to peak). " +
				"Slow rockets (< 14) look like floating balloons, not fireworks.",
		},
		{
			test: (code) => !/vertexColors\s*:\s*true/.test(code),
			message:
				"Burst particles must use vertexColors: true on PointsMaterial with a vivid multi-color palette " +
				"(red, gold, blue, magenta, green, orange). Single-color or white particles are invisible in daylit scenes.",
		},
		{
			test: (code) => !/function\s+explode|const\s+explode\s*=/.test(code),
			message:
				"Missing explode() function. Burst particles must be spawned at the rocket's current position " +
				"when it reaches peak height — not initialized at a fixed Y offset. " +
				"explode(r) copies rPos[r] into bPos[] for all burst particles of rocket r.",
		},
	],
};
