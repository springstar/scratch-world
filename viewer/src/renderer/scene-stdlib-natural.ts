/**
 * scene-stdlib-natural.ts
 *
 * Natural environment primitives for the sceneCode sandbox.
 * Extracted from scene-stdlib.ts to keep file length under 800 lines.
 *
 * Exports three functions via createNaturalStdlib():
 *   makeRiver         — animated river channel with banks
 *   makeKarstPeak     — near-vertical limestone spire (not a sphere/cone)
 *   makeTerracedSlope — stepped agricultural terraces with optional flooded paddy
 */

import * as THREE from "three/webgpu";
import { applyTerrainPbr } from "./texture-cache.js";

// ── Shared type ──────────────────────────────────────────────────────────────
interface Vec3 { x: number; y: number; z: number }

// ── makeRiver ────────────────────────────────────────────────────────────────

export interface MakeRiverOpts {
  /** River channel width in metres (default 18) */
  width?: number;
  /** Length along Z axis (default 80) */
  length?: number;
  /** Curve intensity: 0 = straight, 1 = strong meander (default 0.3) */
  meander?: number;
  /** Y-level of water surface (default 0) */
  waterY?: number;
  /** Depth of the riverbed below waterY (default 1.2) */
  bedDepth?: number;
  /** Water colour hex (default 0x2d5a6e — dark teal) */
  waterColor?: number;
  position?: Vec3;
}

// ── makeKarstPeak ────────────────────────────────────────────────────────────

export interface MakeKarstPeakOpts {
  /** Total height in metres (default 60) */
  height?: number;
  /** Base radius in metres (default 20) */
  radius?: number;
  /** Rock colour hex (default 0x6a7060 — grey-green limestone) */
  color?: number;
  /** Wispy mist planes clinging to mid-peak (default true) */
  mist?: boolean;
  position?: Vec3;
}

// ── makeTerracedSlope ────────────────────────────────────────────────────────

export interface MakeTerracedSlopeOpts {
  /** Number of terrace steps (default 5) */
  steps?: number;
  /** Total elevation rise from base to top in metres (default 16) */
  totalHeight?: number;
  /** Width of the slope face in metres (default 40) */
  width?: number;
  /** Horizontal depth of each tread (default 6) */
  terracesDepth?: number;
  /** Which step index (0-based) to flood with water (-1 = none, default -1) */
  floodedStep?: number;
  /** Tread surface colour (default 0x4a6a30 — wet paddy green) */
  topColor?: number;
  /** Riser face colour (default 0x7a5a30 — earth brown) */
  riserColor?: number;
  position?: Vec3;
  rotationY?: number;
}

// ── makeGateway ──────────────────────────────────────────────────────────────

export interface MakeGatewayOpts {
  /** Total height in metres (default 10) */
  height?: number;
  /** Total width in metres (default 14) */
  width?: number;
  /** Depth / thickness along Z axis (default 3) */
  depth?: number;
  /** Arch crown height above ground — must be < height (default 6) */
  archHeight?: number;
  /** Arch opening width — must be < width (default 6) */
  archWidth?: number;
  /** Base colour — default 0xd4c8a0 (limestone cream) */
  color?: number;
  position?: Vec3;
  rotationY?: number;
}

export interface MakeDisplacedGroundOpts {
  /** World size (square footprint) in metres. Default 120. */
  size?: number;
  /** Maximum elevation amplitude in metres. Default 4.
   *  1-2 = gentle meadow, 3-6 = rolling hills, 8-12 = dramatic terrain. */
  amplitude?: number;
  /** Deterministic seed — same seed produces identical terrain. Default 1. */
  seed?: number;
  /** Subdivisions per side. Default 64 (≈8 k vertices — safe on WebGPU). */
  segments?: number;
  /** Base mesh color (hex). Default 0x4a5a30 (muted olive-green). */
  color?: number;
  /** Y world position of the mesh. Default 0. */
  yOffset?: number;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export interface NaturalStdlibFns {
  makeRiver(opts?: MakeRiverOpts): THREE.Group;
  makeKarstPeak(opts?: MakeKarstPeakOpts): THREE.Group;
  makeTerracedSlope(opts?: MakeTerracedSlopeOpts): THREE.Group;
  makeGateway(opts?: MakeGatewayOpts): THREE.Group;
  makeDisplacedGround(opts?: MakeDisplacedGroundOpts): THREE.Mesh;
}

export function createNaturalStdlib(
  scene: THREE.Scene,
  animateFn: (cb: (delta: number) => void) => void,
  invalidateFn: (frames?: number) => void,
): NaturalStdlibFns {

  const inv = () => invalidateFn(2);

  // ── makeRiver ──────────────────────────────────────────────────────────────
  function makeRiver(opts: MakeRiverOpts = {}): THREE.Group {
    const width     = opts.width     ?? 18;
    const length    = opts.length    ?? 80;
    const waterY    = opts.waterY    ?? 0;
    const bedDepth  = opts.bedDepth  ?? 1.2;
    const waterColor = opts.waterColor ?? 0x2d5a6e;
    const pos       = opts.position  ?? { x: 0, y: 0, z: 0 };

    const g = new THREE.Group();

    // Riverbed — sunken channel slightly wider than water surface
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x1a2820, roughness: 0.95 });
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.4, bedDepth, length),
      bedMat,
    );
    bed.position.set(0, waterY - bedDepth / 2, 0);
    bed.receiveShadow = true;
    g.add(bed);

    // Water surface — flat plane with shimmer animation
    const waterMat = new THREE.MeshStandardMaterial({
      color: waterColor,
      roughness: 0.1,
      metalness: 0.5,
      transparent: true,
      opacity: 0.88,
    });
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length),
      waterMat,
    );
    water.rotation.x = -Math.PI / 2;
    // Offset 2 cm above ground plane to prevent z-fighting with the floor mesh
    water.position.set(0, waterY + 0.02, 0);
    // No shadow reception — prevents scan-line acne at oblique viewing angles
    water.receiveShadow = false;
    g.add(water);

    // Banks — thin muddy platforms either side of the channel
    const bankMat = new THREE.MeshStandardMaterial({ color: 0x5a4a30, roughness: 0.9 });
    applyTerrainPbr(bankMat, "aerial_grass_rock", 6, inv);
    const bankH = 0.18;
    [-1, 1].forEach((side) => {
      const bank = new THREE.Mesh(
        new THREE.BoxGeometry(3.5, bankH, length),
        bankMat,
      );
      bank.position.set(side * (width / 2 + 1.75), waterY - bankH / 2 + 0.02, 0);
      bank.receiveShadow = true;
      g.add(bank);
    });

    // Light shimmer: cycle envMapIntensity on water surface
    let elapsed = 0;
    animateFn((delta) => {
      elapsed += delta;
      waterMat.envMapIntensity = 0.7 + Math.sin(elapsed * 0.35) * 0.3;
    });

    g.position.set(pos.x, pos.y, pos.z);
    scene.add(g);
    return g;
  }

  // ── makeKarstPeak ──────────────────────────────────────────────────────────
  function makeKarstPeak(opts: MakeKarstPeakOpts = {}): THREE.Group {
    const height  = opts.height ?? 60;
    const radius  = opts.radius ?? 20;
    const color   = opts.color  ?? 0x6a7060;
    const mist    = opts.mist   ?? true;
    const pos     = opts.position ?? { x: 0, y: 0, z: 0 };

    const g = new THREE.Group();

    // Karst silhouette profile — wider base gives mountain proportions, not a spire.
    // X values are normalized [0..1] relative to `radius`; Y values relative to `height`.
    // The profile flares from a narrow rounded tip to a broad base (aspect ~2:1).
    const profilePts: [number, number][] = [
      [0.00, 1.00], // peak tip
      [0.10, 0.88], // slight shoulder near apex
      [0.28, 0.70], // concave waist
      [0.42, 0.80], // bulge below waist
      [0.55, 0.55], // lower concave
      [0.72, 0.25], // broad lower flare
      [0.85, 0.08], // near-base spread
      [1.00, 0.00], // base edge
    ];
    const points = profilePts.map(([r, y]) => new THREE.Vector2(r * radius, y * height));

    const spineMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.88,
      metalness: 0.0,
    });
    applyTerrainPbr(spineMat, "rock_face", 3, inv);
    // 24 lathe segments for a smooth silhouette (10 segments looks faceted/architectural)
    const spineGeo = new THREE.LatheGeometry(points, 24);
    const spine = new THREE.Mesh(spineGeo, spineMat);
    spine.castShadow = true;
    // Disable self-shadowing — the concave profile produces harsh dark bands otherwise
    spine.receiveShadow = false;
    g.add(spine);

    // Mist planes — semi-transparent quads at 30 / 50 / 65% of peak height
    if (mist) {
      const mistMeshes: THREE.Mesh[] = [];
      [0.30, 0.50, 0.65].forEach((frac) => {
        const mistMat = new THREE.MeshBasicMaterial({
          color: 0xd0dcd8,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const mistMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(radius * 3.0, radius * 0.8),
          mistMat,
        );
        mistMesh.position.set(0, height * frac, 0);
        mistMesh.rotation.x = -Math.PI / 12; // slight tilt
        g.add(mistMesh);
        mistMeshes.push(mistMesh);
      });

      // Animate mist opacity — single animate() for all three planes
      let elapsed = 0;
      animateFn((delta) => {
        elapsed += delta;
        mistMeshes.forEach((m, i) => {
          (m.material as THREE.MeshBasicMaterial).opacity =
            0.12 + Math.sin(elapsed * 0.4 + i * 1.1) * 0.08;
        });
      });
    }

    g.position.set(pos.x, pos.y, pos.z);
    scene.add(g);
    return g;
  }

  // ── makeTerracedSlope ──────────────────────────────────────────────────────
  function makeTerracedSlope(opts: MakeTerracedSlopeOpts = {}): THREE.Group {
    const steps        = opts.steps        ?? 5;
    const totalHeight  = opts.totalHeight  ?? 16;
    const width        = opts.width        ?? 40;
    const terracesDepth = opts.terracesDepth ?? 6;
    const floodedStep  = opts.floodedStep  ?? -1;
    const topColor     = opts.topColor     ?? 0x4a6a30;
    const riserColor   = opts.riserColor   ?? 0x7a5a30;
    const pos          = opts.position     ?? { x: 0, y: 0, z: 0 };
    const rotY         = opts.rotationY    ?? 0;

    const g = new THREE.Group();
    const stepH = totalHeight / steps;

    const treadMat = new THREE.MeshStandardMaterial({ color: topColor,   roughness: 0.9 });
    const riserMat = new THREE.MeshStandardMaterial({ color: riserColor, roughness: 0.95 });
    applyTerrainPbr(treadMat, "aerial_grass_rock", 4, inv);
    applyTerrainPbr(riserMat, "gravel_dirt_02",    3, inv);

    for (let i = 0; i < steps; i++) {
      const y = i * stepH;
      const z = -(i * terracesDepth);

      // Tread
      const tread = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.18, terracesDepth),
        i === floodedStep
          ? new THREE.MeshStandardMaterial({
              color: 0x3a6a80, roughness: 0.06, metalness: 0.4,
              transparent: true, opacity: 0.78,
            })
          : treadMat,
      );
      tread.position.set(0, y + 0.09, z);
      tread.receiveShadow = true;
      g.add(tread);

      // Riser (vertical face at front of this tread)
      const riser = new THREE.Mesh(
        new THREE.BoxGeometry(width, stepH, 0.28),
        riserMat,
      );
      riser.position.set(0, y - stepH / 2, z + terracesDepth / 2);
      riser.castShadow = true;
      riser.receiveShadow = true;
      g.add(riser);
    }

    g.position.set(pos.x, pos.y, pos.z);
    g.rotation.y = rotY;
    scene.add(g);
    return g;
  }

  // ── makeGateway ────────────────────────────────────────────────────────────
  function makeGateway(opts: MakeGatewayOpts = {}): THREE.Group {
    const height     = opts.height     ?? 10;
    const width      = opts.width      ?? 14;
    const depth      = opts.depth      ?? 3;
    const archHeight = opts.archHeight ?? 6;
    const archWidth  = opts.archWidth  ?? 6;
    const color      = opts.color      ?? 0xd4c8a0;
    const pos        = opts.position   ?? { x: 0, y: 0, z: 0 };
    const rotY       = opts.rotationY  ?? 0;

    const g = new THREE.Group();

    const halfW   = width / 2;
    const halfAW  = archWidth / 2;
    // Height at which the semicircular crown begins (rectangular section below this)
    const springH = Math.max(0, archHeight - halfAW);

    // Outer silhouette — full rectangle
    const shape = new THREE.Shape();
    shape.moveTo(-halfW, 0);
    shape.lineTo( halfW, 0);
    shape.lineTo( halfW, height);
    shape.lineTo(-halfW, height);
    shape.lineTo(-halfW, 0);

    // Arch opening: rectangular base + semicircular crown
    if (halfAW > 0 && halfAW < halfW && archHeight > 0 && archHeight < height) {
      const hole = new THREE.Path();
      hole.moveTo(-halfAW, 0);
      hole.lineTo(-halfAW, springH);
      // Semicircular arch crown — from left spring (Math.PI) to right spring (0), going upward (CCW)
      hole.absarc(0, springH, halfAW, Math.PI, 0, false);
      // Now at (halfAW, springH)
      hole.lineTo(halfAW, 0);
      hole.lineTo(-halfAW, 0);
      shape.holes.push(hole);
    }

    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    // Center on Z so the arch faces equally from both sides
    geo.translate(0, 0, -depth / 2);

    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0.0 });
    applyTerrainPbr(mat, "rock_face", 5, inv);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    g.add(mesh);

    g.position.set(pos.x, pos.y, pos.z);
    g.rotation.y = rotY;
    scene.add(g);
    return g;
  }

  // ── makeDisplacedGround ──────────────────────────────────────────────────────

  /**
   * Ground plane with CPU-side FBm vertex displacement.
   * Uses pure vertex position changes — no DataTexture, no extra texture slot.
   * Safe within the WebGPU 16-slot budget.
   *
   * @example
   *   stdlib.makeDisplacedGround({ size: 120, amplitude: 4, seed: 42, color: 0x4a5a30 });
   *   // amplitude guide: 1-2 = meadow, 3-6 = rolling hills, 8-12 = dramatic terrain
   *   // Call BEFORE forestZone() so tree trunks sit on visible ground.
   *   // Do NOT combine with makeTerrain("floor") at y=0 — they overlap.
   */
  function makeDisplacedGround(opts: MakeDisplacedGroundOpts = {}): THREE.Mesh {
    const {
      size      = 120,
      amplitude = 4,
      seed      = 1,
      segments  = 64,
      color     = 0x4a5a30,
      yOffset   = 0,
    } = opts;

    // Value noise: deterministic, no external dependency
    function noise2(nx: number, nz: number): number {
      const n = Math.sin(nx * 127.1 + nz * 311.7) * 43758.5453;
      return (n - Math.floor(n)) * 2 - 1;
    }

    // 3-octave fractional Brownian motion
    function fbm(fx: number, fz: number): number {
      let v = 0, a = 0.5, f = 1;
      for (let i = 0; i < 3; i++) {
        v += a * noise2(fx * f, fz * f);
        a *= 0.5;
        f *= 2.1;
      }
      return v;
    }

    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = fbm(x * 0.04 + seed, z * 0.04 + seed) * amplitude;
      pos.setY(i, h);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
    applyTerrainPbr(mat, "soil_dry", 8);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.position.y = yOffset;
    scene.add(mesh);
    return mesh;
  }

  return { makeRiver, makeKarstPeak, makeTerracedSlope, makeGateway, makeDisplacedGround };
}
