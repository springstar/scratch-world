/**
 * scene-stdlib.ts
 *
 * Scene Standard Library — injected into the sceneCode sandbox as `stdlib`.
 * AI-generated sceneCode calls these helpers instead of raw Three.js boilerplate.
 *
 * All functions are exposed on the StdlibApi object returned by createStdlib().
 */

import * as THREE from "three/webgpu";
import { color, normalLocal, positionLocal, mix } from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { loadEnvMap, loadSkyBackground } from "./hdri-cache.js";
import { applyTerrainPbr, applyTerrainPbrNode, setupUv2 } from "./texture-cache.js";
import { createLayout, type SceneLayout, type LayoutOpts } from "./layout-solver.js";
import {
  createNaturalStdlib,
  type NaturalStdlibFns,
  type MakeRiverOpts,
  type MakeKarstPeakOpts,
  type MakeTerracedSlopeOpts,
} from "./scene-stdlib-natural.js";

export type { MakeRiverOpts, MakeKarstPeakOpts, MakeTerracedSlopeOpts };

// ── Type palette ──────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, number> = {
  building: 0x8b7355,
  terrain:  0x4a7c59,
  tree:     0x2d5a27,
  npc:      0xe8c97e,
  item:     0xd4af37,
  object:   0x9b9b9b,
};

// ── Env preset ────────────────────────────────────────────────────────────────
interface EnvPreset {
  skyColor: number;
  groundColor: number;
  fogColor: number;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  ambientIntensity: number;
  sky: {
    turbidity: number;
    rayleigh: number;
    mieCoefficient: number;
    mieDirectionalG: number;
    elevation: number;
    azimuth: number;
  } | null;
}

function resolveEnvPreset(skybox?: string, timeOfDay?: string): EnvPreset {
  let skyColor: number;
  switch (skybox) {
    case "sunset":   skyColor = 0xff7043; break;
    case "night":    skyColor = 0x0a0a1a; break;
    case "overcast": skyColor = 0x7b8b9e; break;
    default:         skyColor = 0x87ceeb; break;
  }

  const tod = timeOfDay ?? skybox;
  switch (tod) {
    case "dawn": case "dusk": case "sunset":
      return { skyColor, groundColor: 0x4a7c59, fogColor: skyColor,
        sunColor: 0xff8c42, sunIntensity: 0.8, sunPosition: [10, 5, 30],
        ambientIntensity: 0.35,
        sky: { turbidity: 10, rayleigh: 3, mieCoefficient: 0.005, mieDirectionalG: 0.7, elevation: 4, azimuth: 180 } };
    case "night":
      return { skyColor, groundColor: 0x4a7c59, fogColor: skyColor,
        sunColor: 0x2244aa, sunIntensity: 0.05, sunPosition: [0, 20, 0],
        ambientIntensity: 0.15, sky: null };
    case "noon":
      return { skyColor, groundColor: 0x4a7c59, fogColor: skyColor,
        sunColor: 0xffffff, sunIntensity: 1.4, sunPosition: [5, 60, 10],
        ambientIntensity: 0.55,
        sky: { turbidity: 2, rayleigh: 0.5, mieCoefficient: 0.002, mieDirectionalG: 0.8, elevation: 70, azimuth: 180 } };
    case "overcast":
      return { skyColor, groundColor: 0x4a7c59, fogColor: skyColor,
        sunColor: 0xccccdd, sunIntensity: 0.6, sunPosition: [0, 40, 0],
        ambientIntensity: 0.6,
        sky: { turbidity: 20, rayleigh: 4, mieCoefficient: 0.02, mieDirectionalG: 0.5, elevation: 40, azimuth: 180 } };
    default:
      return { skyColor, groundColor: 0x4a7c59, fogColor: skyColor,
        sunColor: 0xfff4e0, sunIntensity: 1.2, sunPosition: [30, 50, 20],
        ambientIntensity: 0.5,
        sky: { turbidity: 4, rayleigh: 1, mieCoefficient: 0.003, mieDirectionalG: 0.75, elevation: 35, azimuth: 180 } };
  }
}

// ── NPC animation state ───────────────────────────────────────────────────────
interface NpcState {
  root: THREE.Object3D;
  baseY: number;
  phase: number;
  mode: "idle" | "randomwalk" | "patrol";
  speed: number;
  origin: THREE.Vector3;
  maxRadius: number;
  waypoints: THREE.Vector3[];
  wpIdx: number;
  walkState: "pausing" | "walking";
  pauseTimer: number;
  target: THREE.Vector3 | null;
  elapsed: number;
  mixer: THREE.AnimationMixer | null;
  walkAction: THREE.AnimationAction | null;
  idleAction: THREE.AnimationAction | null;
}

function tickNpc(npc: NpcState, delta: number): void {
  npc.elapsed += delta;

  // GLTF mixer update
  if (npc.mixer) {
    npc.mixer.update(delta);
    return; // position handled below regardless
  }

  // Procedural idle animation
  npc.phase += delta;
  const bob = Math.sin(npc.phase * 2.2) * 0.03;
  const sway = Math.sin(npc.phase * 1.1) * 0.035;
  npc.root.position.y = npc.baseY + bob;
  npc.root.rotation.z = sway;

  if (npc.mode === "idle") return;

  if (npc.mode === "patrol" && npc.waypoints.length > 0) {
    if (!npc.target) npc.target = npc.waypoints[npc.wpIdx].clone();
    const dx = npc.target.x - npc.root.position.x;
    const dz = npc.target.z - npc.root.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.3) {
      npc.wpIdx = (npc.wpIdx + 1) % npc.waypoints.length;
      npc.target = npc.waypoints[npc.wpIdx].clone();
    } else {
      npc.root.position.x += (dx / dist) * npc.speed * delta;
      npc.root.position.z += (dz / dist) * npc.speed * delta;
      npc.root.rotation.y = Math.atan2(dx, dz);
    }
    return;
  }

  if (npc.mode === "randomwalk") {
    if (npc.walkState === "pausing") {
      npc.pauseTimer -= delta;
      if (npc.pauseTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * npc.maxRadius;
        npc.target = new THREE.Vector3(
          npc.origin.x + Math.cos(angle) * r,
          npc.baseY,
          npc.origin.z + Math.sin(angle) * r,
        );
        npc.walkState = "walking";
      }
      return;
    }
    if (npc.target) {
      const dx = npc.target.x - npc.root.position.x;
      const dz = npc.target.z - npc.root.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.3) {
        npc.walkState = "pausing";
        npc.pauseTimer = 1.5 + Math.random() * 2;
        npc.target = null;
      } else {
        npc.root.position.x += (dx / dist) * npc.speed * delta;
        npc.root.position.z += (dz / dist) * npc.speed * delta;
        npc.root.rotation.y = Math.atan2(dx, dz);
      }
    }
  }
}

// ── Stdlib factory ────────────────────────────────────────────────────────────

export interface SetupLightingOpts {
  skybox?: "clear_day" | "sunset" | "night" | "overcast" | string;
  timeOfDay?: string;
  isIndoor?: boolean;
  hdri?: boolean;
}

export interface MakeNpcOpts {
  position: { x: number; y: number; z: number };
  name?: string;
  modelUrl?: string;
  idleClip?: string;
  walkClip?: string;
  moveMode?: "idle" | "randomwalk" | "patrol";
  speed?: number;
  maxRadius?: number;
  waypoints?: Array<{ x: number; z: number }>;
  chatter?: string[];
}

export interface LoadModelOpts {
  position?: { x: number; y: number; z: number };
  scale?: number;
  rotation?: { x?: number; y?: number; z?: number };
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface MakeTerrainOpts {
  width?: number;
  depth?: number;
  height?: number;
  texture?: string;
  color?: number;
  position?: { x: number; y: number; z: number };
}

export interface MakeBuildingOpts {
  width?: number;
  depth?: number;
  height?: number;
  style?: string;
  color?: number;
  position?: { x: number; y: number; z: number };
  rotationY?: number;
}

export interface StdlibApi {
  // Lighting & environment
  setupLighting(opts?: SetupLightingOpts): void;

  // Material helpers
  makeMat(col: number, roughness?: number, metalness?: number): THREE.MeshStandardMaterial;

  /**
   * Physical material — clearcoat, transmission, anisotropy, iridescence.
   * Use instead of makeMat() when the surface needs:
   *   - clearcoat: polished hardwood floors, lacquered surfaces, car paint
   *   - transmission: glass panels, water bottles, ice
   *   - anisotropy: brushed metal (poles, rails)
   *   - iridescence: soap bubbles, oily puddles (rare)
   */
  makePhysicalMat(col: number, opts?: {
    roughness?:          number; // base roughness (default 0.5)
    metalness?:          number; // default 0
    clearcoat?:          number; // 0–1, lacquer over the base (default 0)
    clearcoatRoughness?: number; // roughness of the clearcoat layer (default 0.1)
    transmission?:       number; // 0–1, glass-like refractive transparency (default 0)
    ior?:                number; // index of refraction: glass=1.5, diamond=2.4 (default 1.5)
    thickness?:          number; // transmission depth in world units (default 0.5)
    anisotropy?:         number; // 0–1, brushed metal directional highlight (default 0)
    iridescence?:        number; // 0–1, oil-film colour shift (default 0)
  }): THREE.MeshPhysicalMaterial;
  makeTerrainSlopeMat(topColor: number, sideColor: number, lo?: number, hi?: number): THREE.MeshStandardNodeMaterial;
  makeMountainMat(snowColor?: number, rockColor?: number): THREE.MeshStandardNodeMaterial;
  applyPbr(mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial, textureId: string, repeat: number, displacementScale?: number): void;

  // Asset loaders
  loadModel(url: string, opts?: LoadModelOpts): Promise<THREE.Group>;
  makeNpc(opts: MakeNpcOpts): Promise<THREE.Group>;

  // Geometry builders
  makeTerrain(shape: "floor" | "hill" | "cliff" | "platform" | "water" | "wall" | "court", opts?: MakeTerrainOpts): THREE.Object3D;
  makeBuilding(opts?: MakeBuildingOpts): THREE.LOD;
  makeTree(opts?: { scale?: number; colorSeed?: number; position?: { x: number; y: number; z: number } }): THREE.Group;
  makeWater(width: number, depth: number, y?: number): THREE.Group;
  makeCanvasTexture(text: string, opts?: { bg?: string; fg?: string; font?: string; w?: number; h?: number }): THREE.CanvasTexture;

  // Semantic layout solver
  useLayout(type: string, opts?: LayoutOpts): SceneLayout;

  // Natural environment primitives (see scene-stdlib-natural.ts)
  makeRiver(opts?: MakeRiverOpts): THREE.Group;
  makeKarstPeak(opts?: MakeKarstPeakOpts): THREE.Group;
  makeTerracedSlope(opts?: MakeTerracedSlopeOpts): THREE.Group;

  // Utilities
  colorFor(type: string): number;
  seed(x: number, z: number): number;
  invalidate(): void;
  addAmbientSound(url: string, volume?: number): AudioContext;
}

const gltfLoader = new GLTFLoader();

export function createStdlib(
  scene: THREE.Scene,
  camera: THREE.Camera,
  renderer: THREE.WebGPURenderer,
  animateFn: (cb: (delta: number) => void) => void,
  invalidateFn: (frames?: number) => void,
  setWorldGroundFn: (visible: boolean) => void = () => {},
): StdlibApi {

  const inv = () => invalidateFn(2);

  // ── LOD hysteresis state — lazily registered when first building is added ──
  const lodObjects: Array<{ lod: THREE.LOD; level: number }> = [];
  let lodSystemRegistered = false;
  function ensureLodSystem() {
    if (lodSystemRegistered) return;
    lodSystemRegistered = true;
    animateFn(() => {
      for (const entry of lodObjects) {
        const dist = camera.position.distanceTo(entry.lod.position);
        const levels = entry.lod.levels;
        let ideal = levels.length - 1;
        for (let i = 0; i < levels.length; i++) {
          if (dist < levels[i].distance + (levels[i + 1]?.distance ?? Infinity)) {
            ideal = i;
            break;
          }
        }
        if (ideal !== entry.level) {
          entry.level = ideal;
          entry.lod.levels.forEach((l, i) => { l.object.visible = i === ideal; });
          invalidateFn(1);
        }
      }
    });
  }

  // ── NPC tick system — lazily registered when first NPC is added ──────────
  const npcStates: NpcState[] = [];
  let npcSystemRegistered = false;
  function ensureNpcSystem() {
    if (npcSystemRegistered) return;
    npcSystemRegistered = true;
    animateFn((delta) => {
      for (const npc of npcStates) tickNpc(npc, delta);
      if (npcStates.length > 0) invalidateFn(1);
    });
  }

  return {
    // ── Lighting ────────────────────────────────────────────────────────────────
    setupLighting(opts: SetupLightingOpts = {}) {
      const { skybox, timeOfDay, isIndoor = false, hdri = true } = opts;
      const preset = resolveEnvPreset(skybox, timeOfDay);

      // Hemisphere + directional
      const hemi = new THREE.HemisphereLight(preset.skyColor, preset.groundColor,
        isIndoor ? preset.ambientIntensity * 0.3 : preset.ambientIntensity);
      scene.add(hemi);

      const sun = new THREE.DirectionalLight(preset.sunColor,
        isIndoor ? preset.sunIntensity * 0.05 : preset.sunIntensity);
      sun.position.set(...preset.sunPosition);
      // Indoor: directional sun provides only ambient fill — no shadow casting.
      // Shadow map on a near-horizontal floor with an angled sun creates perspective
      // aliasing strips that are visible at low camera angles. PointLights placed by
      // the AI handle all interior illumination; they must have castShadow = false.
      sun.castShadow = !isIndoor;
      if (!isIndoor) {
        sun.shadow.mapSize.set(4096, 4096);
        const shadowHalf = 80; // covers ±80 m — enough for village/town/city scenes
        sun.shadow.camera.left = -shadowHalf; sun.shadow.camera.right = shadowHalf;
        sun.shadow.camera.top  =  shadowHalf; sun.shadow.camera.bottom = -shadowHalf;
        sun.shadow.camera.near =   1; sun.shadow.camera.far = 300;
        sun.shadow.normalBias = 0.015;
        sun.shadow.bias = -0.0005;
        // Mark as the trusted stdlib sun so the renderer's force-disable traverse skips it.
        sun.userData["isSun"] = true;
      }
      scene.add(sun);

      // Tag the scene so the renderer can apply indoor-specific post-processing
      scene.userData["isIndoor"] = isIndoor;

      // Fog
      const fog = scene.fog as THREE.Fog;
      if (fog) {
        fog.color.set(preset.fogColor);
        fog.near = isIndoor ? 300 : 30;
        fog.far  = isIndoor ? 600 : 90;
      }

      if (isIndoor) {
        // Indoor: dark background (no sky), hide the persistent world ground plane
        scene.background = new THREE.Color(0x111118);
        setWorldGroundFn(false);
      } else {
        // Flat background colour (overridden by HDRI or sky panorama below)
        scene.background = new THREE.Color(preset.skyColor);

        // Horizon fill — a large flat plane that prevents the HDRI photographic
        // ground from showing through at the edges of AI-generated scenes.
        // Sits slightly below y=0 so it never z-fights with scene geometry.
        // No textures, no shadows — just a neutral earth-tone canvas that fades
        // into the scene's fog before the camera can reach its edge.
        const fillGeo = new THREE.PlaneGeometry(2000, 2000, 1, 1);
        const fillMat = new THREE.MeshBasicMaterial({ color: 0x857060 });
        const fillMesh = new THREE.Mesh(fillGeo, fillMat);
        fillMesh.rotation.x = -Math.PI / 2;
        fillMesh.position.y = -0.08;
        fillMesh.renderOrder = -1;
        scene.add(fillMesh);
      }

      // Async HDRI env map for physically correct IBL (outdoor only)
      if (hdri && skybox && !isIndoor) {
        loadEnvMap(skybox, renderer)
          .then((envMap) => { scene.environment = envMap; inv(); })
          .catch(() => {});
        if (preset.sky !== null) {
          loadSkyBackground(skybox)
            .then((bgTex) => { scene.background = bgTex; inv(); })
            .catch(() => {});
        }
      }
    },

    // ── Material helpers ────────────────────────────────────────────────────────
    makeMat(col: number, roughness = 0.8, metalness = 0.1) {
      return new THREE.MeshStandardMaterial({ color: col, roughness, metalness });
    },

    makePhysicalMat(col: number, opts: {
      roughness?: number; metalness?: number;
      clearcoat?: number; clearcoatRoughness?: number;
      transmission?: number; ior?: number; thickness?: number;
      anisotropy?: number; iridescence?: number;
    } = {}) {
      const {
        roughness          = 0.5,
        metalness          = 0,
        clearcoat          = 0,
        clearcoatRoughness = 0.1,
        transmission       = 0,
        ior                = 1.5,
        thickness          = 0.5,
        anisotropy         = 0,
        iridescence        = 0,
      } = opts;
      const mat = new THREE.MeshPhysicalMaterial({
        color: col, roughness, metalness,
        clearcoat, clearcoatRoughness,
        transmission, ior, thickness,
        anisotropy, iridescence,
      });
      // transmission requires transparent rendering path
      if (transmission > 0) mat.transparent = true;
      return mat;
    },

    makeTerrainSlopeMat(topColor: number, sideColor: number, lo = 0.35, hi = 0.75) {
      const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
      const blend = normalLocal.y.smoothstep(lo, hi);
      mat.colorNode = mix(color(sideColor), color(topColor), blend);
      return mat;
    },

    makeMountainMat(snowColor = 0xf0f0ee, rockColor = 0x5a5248) {
      const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0 });
      const elevBlend = positionLocal.y.smoothstep(0.52, 0.80);
      mat.colorNode = mix(color(rockColor), color(snowColor), elevBlend);
      return mat;
    },

    applyPbr(mat: THREE.MeshStandardMaterial, textureId: string, repeat: number, displacementScale = 0) {
      applyTerrainPbr(mat, textureId, repeat, inv, displacementScale);
    },

    // ── Asset loaders ───────────────────────────────────────────────────────────
    loadModel(url: string, opts: LoadModelOpts = {}): Promise<THREE.Group> {
      return new Promise((resolve, reject) => {
        gltfLoader.load(url, (gltf) => {
          const group = gltf.scene;
          if (opts.scale !== undefined) group.scale.setScalar(opts.scale);
          if (opts.rotation) {
            if (opts.rotation.x !== undefined) group.rotation.x = opts.rotation.x;
            if (opts.rotation.y !== undefined) group.rotation.y = opts.rotation.y;
            if (opts.rotation.z !== undefined) group.rotation.z = opts.rotation.z;
          }
          if (opts.position) group.position.set(opts.position.x, opts.position.y, opts.position.z);
          group.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              child.castShadow    = opts.castShadow    ?? true;
              child.receiveShadow = opts.receiveShadow ?? true;
            }
          });
          scene.add(group);
          inv();
          resolve(group);
        }, undefined, reject);
      });
    },

    makeNpc(opts: MakeNpcOpts): Promise<THREE.Group> {
      const { position, modelUrl, idleClip, moveMode = "idle",
              speed = 0.8, maxRadius = 3, waypoints = [] } = opts;

      if (modelUrl) {
        return new Promise((resolve, reject) => {
          gltfLoader.load(modelUrl, (gltf) => {
            const group = gltf.scene;
            group.position.set(position.x, position.y, position.z);
            group.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) { child.castShadow = true; child.receiveShadow = true; }
            });

            const mixer = new THREE.AnimationMixer(group);
            let idleAction: THREE.AnimationAction | null = null;
            if (gltf.animations.length > 0) {
              const clip = idleClip
                ? (THREE.AnimationClip.findByName(gltf.animations, idleClip) ?? gltf.animations[0])
                : gltf.animations[0];
              idleAction = mixer.clipAction(clip);
              idleAction.play();
            }

            scene.add(group);
            ensureNpcSystem();
            npcStates.push({
              root: group, baseY: position.y, phase: 0,
              mode: moveMode, speed, origin: new THREE.Vector3(position.x, position.y, position.z),
              maxRadius, waypoints: waypoints.map((w) => new THREE.Vector3(w.x, position.y, w.z)),
              wpIdx: 0, walkState: "pausing", pauseTimer: 0, target: null, elapsed: 0,
              mixer, walkAction: null, idleAction,
            });
            inv();
            resolve(group);
          }, undefined, reject);
        });
      }

      // Procedural fallback (synchronous, returns Promise for uniform API)
      const group = new THREE.Group();
      const s = Math.abs(Math.round(position.x * 3 + position.z * 7)) % 12;
      const shirtColors = [0xcc3333,0x3366cc,0x228844,0xdd8822,0x8833aa,0x336688,
                           0xee5544,0x4488cc,0x33aa66,0xcc7722,0x6644bb,0x228899];
      const pantsColors = [0x222244,0x334422,0x443322,0x111111,0x444466,0x224422,
                           0x221133,0x223311,0x332211,0x000000,0x443355,0x112233];
      const skinTones   = [0xf5c5a0,0xe8a87c,0xc68642,0x8d5524,0xf0d0b0,0xd4956a];
      const skinMat  = new THREE.MeshStandardMaterial({ color: skinTones[s % skinTones.length], roughness: 0.9 });
      const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColors[s], roughness: 0.8 });
      const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColors[s % pantsColors.length], roughness: 0.85 });
      const hairMat  = new THREE.MeshStandardMaterial({ color: [0x1a0a00,0x3d1c02,0xf5c518,0x444444,0xcc5500,0x111111][s % 6], roughness: 0.9 });
      for (const lx of [-0.1, 0.1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.55, 7), pantsMat);
        leg.position.set(lx, 0.275, 0); group.add(leg);
      }
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.22), shirtMat);
      torso.position.set(0, 0.76, 0); group.add(torso);
      for (const ax of [-0.22, 0.22]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.38, 6), shirtMat);
        arm.rotation.z = ax > 0 ? -0.25 : 0.25; arm.position.set(ax, 0.7, 0); group.add(arm);
      }
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 7), skinMat);
      neck.position.set(0, 1.02, 0); group.add(neck);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), skinMat);
      head.position.set(0, 1.23, 0); group.add(head);
      const hair = new THREE.Mesh(
        new THREE.SphereGeometry(0.162, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52), hairMat);
      hair.position.set(0, 1.31, 0); group.add(hair);
      group.position.set(position.x, position.y, position.z);
      group.traverse((child) => { if ((child as THREE.Mesh).isMesh) child.castShadow = true; });
      scene.add(group);
      ensureNpcSystem();
      npcStates.push({
        root: group, baseY: position.y, phase: Math.random() * Math.PI * 2,
        mode: moveMode, speed, origin: new THREE.Vector3(position.x, position.y, position.z),
        maxRadius, waypoints: waypoints.map(w => new THREE.Vector3(w.x, position.y, w.z)),
        wpIdx: 0, walkState: "pausing", pauseTimer: 0, target: null, elapsed: 0,
        mixer: null, walkAction: null, idleAction: null,
      });
      return Promise.resolve(group);
    },

    // ── Terrain builders ────────────────────────────────────────────────────────
    makeTerrain(shape, opts: MakeTerrainOpts = {}) {
      const { width = 20, depth = 20, height = 4, color: col, position: pos = { x: 0, y: 0, z: 0 } } = opts;
      const { x, y, z } = pos;

      if (shape === "floor") {
        const texId = opts.texture ?? "aerial_grass_rock";

        // Extend the mesh well beyond the requested area so the hard edge stays
        // outside the camera frustum and fog finishes the job.  No Z-displacement —
        // any geometry lift creates a visible wall and shadow-map stripe artifacts
        // at low sun angles.  Only vertex-colour darkening is applied at the fringe
        // so the terrain colour fades toward a warm earth tone matching the HDRI.
        const fringeW = Math.min(Math.max(width, depth) * 0.30, 40); // 30% on each side, cap 40 m
        const totalW  = width  + fringeW * 2;
        const totalD  = depth  + fringeW * 2;
        const segsW   = Math.min(Math.ceil(totalW / 4), 64);
        const segsD   = Math.min(Math.ceil(totalD / 4), 64);

        const geo = new THREE.PlaneGeometry(totalW, totalD, segsW, segsD);
        setupUv2(geo);

        const pos3  = geo.attributes.position as THREE.BufferAttribute;
        const col3  = new Float32Array(pos3.count * 3);

        for (let i = 0; i < pos3.count; i++) {
          const lx = pos3.getX(i);
          const ly = pos3.getY(i);

          // t = 0 inside the flat area, ramps to 1 at the outer edge
          const edgeX = Math.max(0, (Math.abs(lx) - width  * 0.5) / fringeW);
          const edgeY = Math.max(0, (Math.abs(ly) - depth  * 0.5) / fringeW);
          const t = Math.min(Math.max(edgeX, edgeY), 1.0);

          // Smooth darkening: inner stays at 1.0 (full brightness), outer fades to ~0.30
          // Cubic ease so the transition is subtle in the middle and sharper at the edge
          const tc = t * t * (3 - 2 * t);          // smoothstep
          const v  = 1.0 - tc * 0.70;              // 1.0 → 0.30
          col3[i * 3    ] = v * 0.96 + tc * 0.20;  // slight warm shift toward brown
          col3[i * 3 + 1] = v * 0.92 + tc * 0.16;
          col3[i * 3 + 2] = v * 0.84 + tc * 0.10;
        }
        geo.setAttribute("color", new THREE.BufferAttribute(col3, 3));
        // No computeVertexNormals — geometry is flat, default normals are correct

        const floorMat = new THREE.MeshStandardMaterial({
          color: col ?? 0xc8b89a, roughness: 1, metalness: 0,
          vertexColors: true,
        });
        const mesh = new THREE.Mesh(geo, floorMat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, y + 0.002, z);
        mesh.receiveShadow = true;
        const repeat = Math.round(Math.max(width, depth) / 3);
        applyTerrainPbr(floorMat, texId, repeat, inv, 0);
        return mesh;
      }

      if (shape === "wall") {
        const wallMat = new THREE.MeshStandardMaterial({ color: col ?? 0xe8e0d0, roughness: 0.95 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.2), wallMat);
        mesh.position.set(x, y, z);
        mesh.receiveShadow = true;
        applyTerrainPbr(wallMat, opts.texture ?? "plastered_wall_02", 4, inv);
        return mesh;
      }

      if (shape === "hill") {
        const radius = width * 0.5;
        const isMountain = height / radius >= 1.2;
        let mesh: THREE.Mesh;
        if (isMountain) {
          const pts = [
            new THREE.Vector2(0, 1), new THREE.Vector2(0.05, 0.88),
            new THREE.Vector2(0.14, 0.72), new THREE.Vector2(0.28, 0.52),
            new THREE.Vector2(0.42, 0.32), new THREE.Vector2(0.50, 0.12),
            new THREE.Vector2(0.50, 0),
          ];
          const geo = new THREE.LatheGeometry(pts, 20);
          setupUv2(geo);
          const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0 });
          const elev = positionLocal.y.smoothstep(0.52, 0.80);
          mat.colorNode = mix(color(0x5a5248), color(0xf0f0ee), elev);
          mesh = new THREE.Mesh(geo, mat);
          mesh.scale.set(width, height, width);
          mesh.position.set(x, y, z);
        } else {
          const geo = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
          setupUv2(geo);
          const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
          const blend = normalLocal.y.smoothstep(0.35, 0.75);
          mat.colorNode = mix(color(0x6e5030), color(0x4a7a3a), blend);
          mesh = new THREE.Mesh(geo, mat);
          mesh.scale.set(width, height, width);
          mesh.position.set(x, y - Math.cos(Math.PI * 0.55) * height, z);
          applyTerrainPbrNode(mat, "aerial_grass_rock", 4, 0x4a7a3a, 0x6e5030, 0.35, 0.75, inv);
        }
        mesh.receiveShadow = true; mesh.castShadow = true;
        return mesh;
      }

      if (shape === "cliff") {
        const geo = new THREE.BoxGeometry(width, height, depth, 8, 10, 3);
        const pos2 = geo.attributes.position;
        const jitter = Math.min(width, depth) * 0.06;
        for (let vi = 0; vi < pos2.count; vi++) {
          const vy = pos2.getY(vi);
          const fade = Math.min(
            Math.abs(vy - height * 0.5) / (height * 0.12),
            Math.abs(vy + height * 0.5) / (height * 0.12), 1,
          );
          if (fade < 0.01) continue;
          const hx = Math.sin(vi * 127.1) * 43758.5453;
          const hz = Math.sin(vi * 311.7) * 43758.5453;
          const hy = Math.sin(vi * 591.3) * 43758.5453;
          pos2.setX(vi, pos2.getX(vi) + (hx - Math.floor(hx) - 0.5) * jitter * fade);
          pos2.setY(vi, pos2.getY(vi) + (hy - Math.floor(hy) - 0.5) * jitter * 0.4 * fade);
          pos2.setZ(vi, pos2.getZ(vi) + (hz - Math.floor(hz) - 0.5) * jitter * fade);
        }
        pos2.needsUpdate = true;
        geo.computeVertexNormals();
        setupUv2(geo);
        const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
        const blend = normalLocal.y.smoothstep(0.7, 0.9);
        mat.colorNode = mix(color(0x5a4a3c), color(0x908070), blend);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y - height * 0.5 + 0.1, z);
        mesh.receiveShadow = true; mesh.castShadow = true;
        applyTerrainPbrNode(mat, "aerial_grass_rock", 3, 0x908070, 0x5a4a3c, 0.7, 0.9, inv);
        return mesh;
      }

      if (shape === "platform") {
        const geo = new THREE.BoxGeometry(width, height, depth, 4, 2, 4);
        setupUv2(geo);
        const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
        const blend = normalLocal.y.smoothstep(0.6, 0.85);
        mat.colorNode = mix(color(0x7a6a58), color(0xb0a282), blend);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y - height * 0.5, z);
        mesh.receiveShadow = true; mesh.castShadow = true;
        applyTerrainPbrNode(mat, "cobblestone_floor_01", 4, 0xb0a282, 0x7a6a58, 0.6, 0.85, inv);
        return mesh;
      }

      if (shape === "court") {
        const group = new THREE.Group();
        // Floor box: top face at y=0.10
        const floor = new THREE.Mesh(new THREE.BoxGeometry(28, 0.1, 15),
          new THREE.MeshStandardMaterial({ color: 0xc8822a, roughness: 0.85, metalness: 0.05 }));
        floor.position.y = 0.05; floor.receiveShadow = true; group.add(floor);
        // Off-white lines: pure white exceeds HDR 1.0 under point lights → bloom glare.
        // 0xf0ede8 (warm off-white) stays below threshold while remaining clearly visible.
        const lineMat = new THREE.MeshStandardMaterial({ color: 0xf0ede8, roughness: 1, metalness: 0 });
        // All line/paint geometry raised to y=0.14 (4 cm above floor top) — eliminates z-fighting
        const lineY = 0.14;
        const cLine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.005, 15), lineMat);
        cLine.position.y = lineY; group.add(cLine);
        const cCirc = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.05, 8, 48), lineMat);
        cCirc.rotation.x = Math.PI / 2; cCirc.position.y = lineY; group.add(cCirc);
        for (const side of [-1, 1]) {
          const paint = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.005, 4.9),
            new THREE.MeshStandardMaterial({ color: 0xb06020, roughness: 0.9 }));
          paint.position.set(side * 11.1, lineY, 0); group.add(paint);
          const arc = new THREE.Mesh(new THREE.TorusGeometry(7.24, 0.05, 8, 48, Math.PI), lineMat);
          arc.rotation.x = Math.PI / 2; arc.rotation.z = side > 0 ? 0 : Math.PI;
          arc.position.set(side * 7.5, lineY, 0); group.add(arc);
        }
        group.position.set(x, y, z);
        return group;
      }

      // water — delegate to makeWater
      if (shape === "water") return this.makeWater(width, depth, y);

      // fallback box
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.5, depth),
        new THREE.MeshStandardMaterial({ color: col ?? 0x888888, roughness: 0.9 }));
      mesh.position.set(x, y, z); mesh.receiveShadow = true;
      return mesh;
    },

    // ── Building LOD ────────────────────────────────────────────────────────────
    makeBuilding(opts: MakeBuildingOpts = {}) {
      const { width: bw = 5, depth: bd = 5, height: bh = 4, style: bStyle = "house",
              rotationY = 0, position: pos = { x: 0, y: 0, z: 0 } } = opts;
      const colorSeed = opts.color !== undefined ? 0 : Math.abs(Math.round(pos.x * 3.7 + pos.z * 5.3)) % 5;
      const wallColors = [0xb5472a, 0x8a7560, 0xd4c4a8, 0x7a6050, 0xb89070];
      const roofColors = [0x6b3a2a, 0x4a3020, 0x5a4a30, 0x3a2a20, 0x7a5535];
      const wallMat = new THREE.MeshStandardMaterial({ color: opts.color ?? wallColors[colorSeed], roughness: 0.85, metalness: 0.05 });
      const roofMat = new THREE.MeshStandardMaterial({ color: roofColors[colorSeed], roughness: 0.8 });
      applyTerrainPbr(wallMat, "red_brick_03", 3, inv);
      const roofR = Math.max(bw, bd) * 0.55;
      const roofH = bStyle === "tower" ? bh * 0.6 : 1.8;

      const glassMat = new THREE.MeshStandardMaterial({
        color: 0x88bbdd, roughness: 0.05, metalness: 0.2,
        transparent: true, opacity: 0.6, emissive: 0x224466, emissiveIntensity: 0.15,
      });

      function makeBody(addWindows: boolean) {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), wallMat);
        body.position.y = bh / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(roofR, roofH, 4), roofMat);
        roof.position.y = bh + roofH / 2; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
        if (addWindows && bw >= 2 && bd >= 2 && bh >= 2) {
          const sw = bw / 5; const sh = bh / 4;
          const winPos: [number, number, number][] = [
            [-1.2*sw,2.8*sh, bd/2+0.01],[1.2*sw,2.8*sh, bd/2+0.01],
            [-1.2*sw,1.2*sh, bd/2+0.01],[1.2*sw,1.2*sh, bd/2+0.01],
            [-1.2*sw,2.8*sh,-bd/2-0.01],[1.2*sw,2.8*sh,-bd/2-0.01],
            [-1.2*sw,1.2*sh,-bd/2-0.01],[1.2*sw,1.2*sh,-bd/2-0.01],
          ];
          for (const [wx,wy,wz] of winPos) {
            const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9*sw, 0.8*sh), glassMat);
            win.position.set(wx,wy,wz); if (wz < 0) win.rotation.y = Math.PI; g.add(win);
          }
        }
        return g;
      }

      const full = makeBody(true);
      const med  = makeBody(false);
      const totalH = bh + roofH * 0.5;
      const low  = new THREE.Mesh(new THREE.BoxGeometry(bw, totalH, bd), wallMat);
      low.position.y = totalH / 2;

      const lod = new THREE.LOD();
      lod.autoUpdate = false;
      lod.addLevel(full, 0);
      lod.addLevel(med, 20);
      lod.addLevel(low, 50);
      lod.rotation.y = rotationY;
      lod.position.set(pos.x, pos.y, pos.z);
      ensureLodSystem();
      lodObjects.push({ lod, level: 0 });
      return lod;
    },

    // ── Tree ─────────────────────────────────────────────────────────────────────
    makeTree(opts = {}) {
      const { scale, colorSeed, position: pos = { x: 0, y: 0, z: 0 } } = opts;
      const { x, y, z } = pos;
      const group = new THREE.Group();
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3d1e, roughness: 0.9 });
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 12), trunkMat);
      trunk.position.y = 1.1; trunk.castShadow = true; group.add(trunk);
      applyTerrainPbr(trunkMat, "bark_brown_02", 2, inv);
      const leafMat = new THREE.MeshStandardMaterial({ color: TYPE_COLORS.tree, roughness: 0.95 });
      for (const [lx, ly, lz, lr] of [[0,2.8,0,1.4],[0.3,3.6,0.2,1.1],[-0.2,4.3,-0.1,0.85]] as [number,number,number,number][]) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(lr, 12, 9), leafMat);
        leaf.scale.y = 0.78; leaf.position.set(lx, ly, lz); leaf.castShadow = true; group.add(leaf);
      }
      const s = scale ?? (0.85 + (Math.abs(x * 7 + z * 13) % 1) * 0.45);
      group.scale.setScalar(s);
      group.rotation.y = colorSeed !== undefined ? colorSeed * Math.PI * 2 : (Math.abs(x * 7 + z * 13) % 1) * Math.PI * 2;
      group.position.set(x, y, z);
      return group;
    },

    // ── Water ────────────────────────────────────────────────────────────────────
    makeWater(width: number, depth: number, y = 0) {
      const group = new THREE.Group();
      // Bed (dark material visible from below/through the water)
      const bedMat = new THREE.MeshStandardMaterial({ color: 0x2a3a3a, roughness: 1 });
      const bed = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), bedMat);
      bed.rotation.x = -Math.PI / 2;
      bed.position.y = y - 0.5;
      bed.receiveShadow = true;
      group.add(bed);
      // Simple animated water plane (WaterMesh not available here — use standard material with animation)
      const waterMat = new THREE.MeshStandardMaterial({
        color: 0x4a8fa8, roughness: 0.1, metalness: 0.3,
        transparent: true, opacity: 0.8,
      });
      const water = new THREE.Mesh(new THREE.PlaneGeometry(width, depth, 16, 16), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.position.y = y + 0.01;
      water.receiveShadow = true;
      group.add(water);
      // Animate normals via UV scroll
      animateFn((delta) => {
        const offset = (waterMat.map?.offset ?? { x: 0, y: 0 });
        offset.x = ((offset.x ?? 0) + delta * 0.02) % 1;
        offset.y = ((offset.y ?? 0) + delta * 0.01) % 1;
        waterMat.needsUpdate = true;
        invalidateFn(1);
      });
      return group;
    },

    // ── Canvas texture ────────────────────────────────────────────────────────────
    makeCanvasTexture(text: string, opts = {}) {
      const { bg = "#1a3a2a", fg = "#faf7f0", font = "72px sans-serif", w = 512, h = 512 } = opts;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = fg; ctx.font = font;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, w / 2, h / 2);
      return new THREE.CanvasTexture(canvas);
    },

    // ── Semantic layout solver ────────────────────────────────────────────────────
    useLayout(type: string, opts: LayoutOpts = {}): SceneLayout {
      return createLayout(type, opts, { scene, stdlib: this });
    },

    // ── Utilities ─────────────────────────────────────────────────────────────────
    colorFor(type: string) {
      return TYPE_COLORS[type] ?? 0xaaaaaa;
    },

    seed(x: number, z: number) {
      return Math.abs(x * 7 + z * 13) % 1;
    },

    invalidate() {
      invalidateFn(2);
    },

    // ── Ambient sound ─────────────────────────────────────────────────────────────
    /**
     * Play a looping ambient sound URL. Uses the Web Audio API.
     * Returns the AudioBufferSourceNode so the caller can stop it if needed.
     * The sound auto-stops when the next scene loads (AudioContext is not persisted).
     *
     * @param url     - Direct URL to an MP3/OGG/WAV file (must allow CORS)
     * @param volume  - Linear gain, 0–1 (default 0.4)
     */
    addAmbientSound(url: string, volume = 0.4) {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);

      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((buf) => ctx.decodeAudioData(buf))
        .then((decoded) => {
          const source = ctx.createBufferSource();
          source.buffer = decoded;
          source.loop = true;
          source.connect(gain);
          source.start(0);
        })
        .catch((err) => {
          console.warn("[stdlib.addAmbientSound] failed to load:", url, err);
        });

      return ctx;
    },

    ...createNaturalStdlib(scene, animateFn, invalidateFn),
  };
}
