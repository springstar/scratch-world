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
  /** Base radius in metres (default 12) */
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

// ── Factory ──────────────────────────────────────────────────────────────────

export interface NaturalStdlibFns {
  makeRiver(opts?: MakeRiverOpts): THREE.Group;
  makeKarstPeak(opts?: MakeKarstPeakOpts): THREE.Group;
  makeTerracedSlope(opts?: MakeTerracedSlopeOpts): THREE.Group;
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
    water.position.set(0, waterY, 0);
    water.receiveShadow = true;
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
    const radius  = opts.radius ?? 12;
    const color   = opts.color  ?? 0x6a7060;
    const mist    = opts.mist   ?? true;
    const pos     = opts.position ?? { x: 0, y: 0, z: 0 };

    const g = new THREE.Group();

    // Karst silhouette profile: near-vertical sides + bulge near top + concave waist
    // These [x, y] points are normalized [0..1] and scaled by radius/height
    const profilePts: [number, number][] = [
      [0,    1.00], // peak tip
      [0.08, 0.82], // slight bulge near top
      [0.25, 0.60], // concave waist
      [0.35, 0.75], // secondary bulge
      [0.45, 0.55], // lower concave
      [0.50, 0.00], // base
    ];
    const points = profilePts.map(([r, y]) => new THREE.Vector2(r * radius, y * height));

    const spineMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.88,
      metalness: 0.0,
    });
    applyTerrainPbr(spineMat, "rock_face", 3, inv);
    const spineGeo = new THREE.LatheGeometry(points, 10);
    const spine = new THREE.Mesh(spineGeo, spineMat);
    spine.castShadow = true;
    spine.receiveShadow = true;
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

  return { makeRiver, makeKarstPeak, makeTerracedSlope };
}
