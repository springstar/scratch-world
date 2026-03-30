/**
 * Deterministic Simplex 2D noise + fractal height function for open-world terrain.
 *
 * Designed for:
 * - stdlib makeWorldTerrain() vertex displacement
 * - Walk mode physics — ground clamping
 * - Object placement — resting elevation queries
 *
 * All functions are pure world-space: same (wx, wz) always returns same height
 * regardless of which chunk or scene generated the call. No boundaries.
 *
 * Algorithm: Simplex 2D based on Stefan Gustavson's public-domain implementation
 * (2003, Linköping University). Adapted to TypeScript with seedable permutation table.
 */

// ---------------------------------------------------------------------------
// Permutation table — seedable
// ---------------------------------------------------------------------------

function buildPerm(seed: number): Uint8Array {
	const perm = new Uint8Array(512);
	const p = new Uint8Array(256);
	// Fill 0..255
	for (let i = 0; i < 256; i++) p[i] = i;
	// Seeded shuffle (Knuth/Fisher-Yates with LCG)
	let s = (seed ^ 0x9e3779b9) >>> 0;
	for (let i = 255; i > 0; i--) {
		// LCG: multiplier 1664525, addend 1013904223
		s = Math.imul(s, 1664525) + 1013904223;
		const j = ((s >>> 0) % (i + 1)) | 0;
		const tmp = p[i];
		p[i] = p[j];
		p[j] = tmp;
	}
	for (let i = 0; i < 256; i++) perm[i] = perm[i + 256] = p[i];
	return perm;
}

// ---------------------------------------------------------------------------
// Simplex 2D gradient helpers
// ---------------------------------------------------------------------------

const GRAD2 = new Float32Array([
	1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1,
]);

function dot2(g: number, x: number, y: number): number {
	const i = g * 2;
	return GRAD2[i] * x + GRAD2[i + 1] * y;
}

function simplex2(perm: Uint8Array, xin: number, yin: number): number {
	// Skew
	const F2 = 0.5 * (Math.sqrt(3) - 1);
	const G2 = (3 - Math.sqrt(3)) / 6;

	const s = (xin + yin) * F2;
	const i = Math.floor(xin + s);
	const j = Math.floor(yin + s);
	const t = (i + j) * G2;
	const X0 = i - t;
	const Y0 = j - t;
	const x0 = xin - X0;
	const y0 = yin - Y0;

	const i1 = x0 > y0 ? 1 : 0;
	const j1 = x0 > y0 ? 0 : 1;

	const x1 = x0 - i1 + G2;
	const y1 = y0 - j1 + G2;
	const x2 = x0 - 1 + 2 * G2;
	const y2 = y0 - 1 + 2 * G2;

	const ii = i & 255;
	const jj = j & 255;
	const gi0 = perm[ii + perm[jj]] % 12;
	const gi1 = perm[ii + i1 + perm[jj + j1]] % 12;
	const gi2 = perm[ii + 1 + perm[jj + 1]] % 12;

	let n0 = 0;
	let t0 = 0.5 - x0 * x0 - y0 * y0;
	if (t0 >= 0) {
		t0 *= t0;
		n0 = t0 * t0 * dot2(gi0, x0, y0);
	}

	let n1 = 0;
	let t1 = 0.5 - x1 * x1 - y1 * y1;
	if (t1 >= 0) {
		t1 *= t1;
		n1 = t1 * t1 * dot2(gi1, x1, y1);
	}

	let n2 = 0;
	let t2 = 0.5 - x2 * x2 - y2 * y2;
	if (t2 >= 0) {
		t2 *= t2;
		n2 = t2 * t2 * dot2(gi2, x2, y2);
	}

	// Scale to [-1, 1]
	return 70 * (n0 + n1 + n2);
}

// ---------------------------------------------------------------------------
// Fractal noise options
// ---------------------------------------------------------------------------

export interface FractalOpts {
	/** World-space frequency of the base octave (cycles per metre). Default: 1/200 */
	frequency?: number;
	/** Number of octaves. Default: 6 */
	octaves?: number;
	/** Lacunarity — frequency multiplier per octave. Default: 2.0 */
	lacunarity?: number;
	/** Persistence — amplitude multiplier per octave. Default: 0.5 */
	persistence?: number;
	/** Maximum peak-to-trough height in metres. Default: 40 */
	amplitude?: number;
	/** Base sea-level offset in metres. Default: 0 */
	seaLevel?: number;
}

const FRACTAL_DEFAULTS: Required<FractalOpts> = {
	frequency: 1 / 200,
	octaves: 6,
	lacunarity: 2.0,
	persistence: 0.5,
	amplitude: 40,
	seaLevel: 0,
};

// ---------------------------------------------------------------------------
// Module-level state — one permutation table, replaceable via configure()
// ---------------------------------------------------------------------------

let _perm: Uint8Array = buildPerm(0);
let _fractalOpts: Required<FractalOpts> = { ...FRACTAL_DEFAULTS };

/**
 * Configure the global terrain noise.
 * Must be called before any height queries if non-default seed or parameters are needed.
 * Subsequent calls replace the configuration (e.g. for different biome zones).
 */
export function configureTerrain(seed: number, opts: FractalOpts = {}): void {
	_perm = buildPerm(seed);
	_fractalOpts = { ...FRACTAL_DEFAULTS, ...opts };
}

// ---------------------------------------------------------------------------
// Core height functions
// ---------------------------------------------------------------------------

/**
 * Fractal Brownian Motion (fBm) height at world-space coordinates.
 * Returns height in metres.
 *
 * @param wx  World X coordinate (metres)
 * @param wz  World Z coordinate (metres)
 * @param opts  Override frequency / octaves / amplitude (merged with global config)
 */
export function fractalHeight(wx: number, wz: number, opts: FractalOpts = {}): number {
	const o = opts && Object.keys(opts).length > 0 ? { ..._fractalOpts, ...opts } : _fractalOpts;

	let freq = o.frequency;
	let amp = 1.0;
	let max = 0.0;
	let value = 0.0;

	for (let i = 0; i < o.octaves; i++) {
		value += simplex2(_perm, wx * freq, wz * freq) * amp;
		max += amp;
		freq *= o.lacunarity;
		amp *= o.persistence;
	}

	// Normalise to [-1, 1] then scale
	return (value / max) * o.amplitude + o.seaLevel;
}

/**
 * Singleton accessor — uses the global configuration.
 * Preferred entry point for stdlib, walk mode, and physics.
 *
 * Returns terrain height (metres) at world position (wx, wz).
 * Same input always returns same output — safe to call per-frame.
 */
export function getTerrainHeight(wx: number, wz: number): number {
	return fractalHeight(wx, wz);
}

/**
 * Compute the approximate terrain normal at (wx, wz) via central finite differences.
 * Useful for aligning objects (trees, rocks) to slope.
 *
 * @param wx  World X
 * @param wz  World Z
 * @param epsilon  Sample offset in metres. Default: 0.5
 * @returns  [nx, ny, nz] — unit normal pointing away from terrain surface
 */
export function getTerrainNormal(wx: number, wz: number, epsilon = 0.5): [number, number, number] {
	const hL = getTerrainHeight(wx - epsilon, wz);
	const hR = getTerrainHeight(wx + epsilon, wz);
	const hD = getTerrainHeight(wx, wz - epsilon);
	const hU = getTerrainHeight(wx, wz + epsilon);
	// Cross product of (2ε, hR−hL, 0) × (0, hU−hD, 2ε)
	const nx = hL - hR;
	const ny = 2 * epsilon;
	const nz = hD - hU;
	const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
	return [nx / len, ny / len, nz / len];
}

/**
 * Generate a flat Float32Array of heights for a grid of (cols × rows) samples.
 * Useful for building DataTexture-based displacement maps on the CPU.
 *
 * @param originX  World X of the grid's left edge
 * @param originZ  World Z of the grid's top edge
 * @param width    Grid width in metres
 * @param depth    Grid depth in metres
 * @param cols     Number of columns (vertices = cols+1 if used for mesh)
 * @param rows     Number of rows
 * @param opts     Optional fractal parameter override
 */
export function sampleHeightGrid(
	originX: number,
	originZ: number,
	width: number,
	depth: number,
	cols: number,
	rows: number,
	opts: FractalOpts = {},
): Float32Array {
	const out = new Float32Array(cols * rows);
	const dx = width / (cols - 1);
	const dz = depth / (rows - 1);
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			out[r * cols + c] = fractalHeight(originX + c * dx, originZ + r * dz, opts);
		}
	}
	return out;
}
