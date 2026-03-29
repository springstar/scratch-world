import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { color, normalLocal, mix, uv, pass, mrt, normalView, output } from "three/tsl";
import { bloom }  from "three/addons/tsl/display/BloomNode.js";
import { smaa }   from "three/addons/tsl/display/SMAANode.js";
import { film }   from "three/examples/jsm/tsl/display/FilmNode.js";
import { ao }     from "three/examples/jsm/tsl/display/GTAONode.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { loadEnvMap, loadSkyBackground } from "./hdri-cache.js";
import { applyTerrainPbr, applyTerrainPbrNode, setupUv2 } from "./texture-cache.js";
import { SkyMesh }   from "three/addons/objects/SkyMesh.js";
import { WaterMesh } from "three/addons/objects/WaterMesh.js";
import type { SceneData, SceneObject, Viewpoint } from "../types.js";
import { createStdlib } from "./scene-stdlib.js";

function makeTerrainSlopeMat(
  topColor: number,
  sideColor: number,
  lo = 0.35,
  hi = 0.75,
  roughness = 0.95,
): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness, metalness: 0 });
  const blend = normalLocal.y.smoothstep(lo, hi);
  mat.colorNode = mix(color(sideColor), color(topColor), blend);
  return mat;
}


// ── Environment presets ──────────────────────────────────────────────────────

interface EnvPreset {
  skyColor: number;       // fallback color for indoor / night
  groundColor: number;
  fogColor: number;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  ambientIntensity: number;
  // Sky shader parameters (outdoor only)
  sky: {
    turbidity: number;      // atmospheric haze 1–20
    rayleigh: number;       // sky blueness
    mieCoefficient: number; // sun halo density
    mieDirectionalG: number;// sun halo sharpness
    elevation: number;      // sun elevation angle in degrees
    azimuth: number;        // sun azimuth angle in degrees
  } | null;                 // null = use flat skyColor (indoor / night)
}

function resolveEnvPreset(skybox?: string, timeOfDay?: string): EnvPreset {
  let skyColor: number;
  switch (skybox) {
    case "sunset":     skyColor = 0xff7043; break;
    case "night":      skyColor = 0x0a0a1a; break;
    case "overcast":   skyColor = 0x7b8b9e; break;
    default:           skyColor = 0x87ceeb; break; // clear_day / default
  }

  let sunColor: number;
  let sunIntensity: number;
  let sunPosition: [number, number, number];
  let ambientIntensity: number;
  let sky: EnvPreset["sky"];

  const tod = timeOfDay ?? skybox;
  switch (tod) {
    case "dawn":
    case "dusk":
    case "sunset":
      sunColor = 0xff8c42;
      sunIntensity = 0.8;
      sunPosition = [10, 5, 30];
      ambientIntensity = 0.35;
      sky = { turbidity: 10, rayleigh: 3, mieCoefficient: 0.005, mieDirectionalG: 0.7, elevation: 4, azimuth: 180 };
      break;
    case "night":
      sunColor = 0x2244aa;
      sunIntensity = 0.05;
      sunPosition = [0, 20, 0];
      ambientIntensity = 0.15;
      sky = null; // flat dark background for night
      break;
    case "noon":
      sunColor = 0xffffff;
      sunIntensity = 1.4;
      sunPosition = [5, 60, 10];
      ambientIntensity = 0.55;
      sky = { turbidity: 2, rayleigh: 0.5, mieCoefficient: 0.002, mieDirectionalG: 0.8, elevation: 70, azimuth: 180 };
      break;
    case "overcast":
      sunColor = 0xccccdd;
      sunIntensity = 0.6;
      sunPosition = [0, 40, 0];
      ambientIntensity = 0.6;
      sky = { turbidity: 20, rayleigh: 4, mieCoefficient: 0.02, mieDirectionalG: 0.5, elevation: 40, azimuth: 180 };
      break;
    default: // clear_day / dawn
      sunColor = 0xfff4e0;
      sunIntensity = 1.2;
      sunPosition = [30, 50, 20];
      ambientIntensity = 0.5;
      sky = { turbidity: 4, rayleigh: 1, mieCoefficient: 0.003, mieDirectionalG: 0.75, elevation: 35, azimuth: 180 };
      break;
  }

  return { skyColor, groundColor: 0x4a7c59, fogColor: skyColor, sunColor, sunIntensity, sunPosition, ambientIntensity, sky };
}

// ── AnimSystem priority queue (inspired by tiny-web-metaverse SystemOrder) ───
//
// Systems run every frame in ascending priority order.
// Explicit ordering prevents the bugs that arise from relying on push() sequence.
//
//  300 Simulation  — NPC movement, physics, state machines
//  500 Culling     — distance culling (must see final positions from Simulation)
//  600 Render      — water UV scroll, particles, sceneCode animate callbacks

const SystemOrder = {
  Simulation: 300,
  Culling:    500,
  Render:     600,
} as const;

interface AnimSystem {
  priority: number;
  tick: (delta: number) => void;
}

// ── PickResult ───────────────────────────────────────────────────────────────

export interface PickResult {
  objectId: string;
  name: string;
  interactable: boolean;
  interactionHint?: string;
}

// ── SceneRenderer ────────────────────────────────────────────────────────────

const TRANSITION_DURATION = 800; // ms

// Minimal sceneCode for scenes with no sceneCode — sets up lighting and shows a reference cube.
const DEFAULT_SCENE_CODE = `
stdlib.setupLighting({ skybox: "clear_day", hdri: true });
scene.fog = null;

// Placeholder pedestal
const geoBase = new THREE.CylinderGeometry(1.2, 1.5, 0.3, 32);
const matBase = stdlib.makeMat(0x8c8070, 0.85, 0.05);
const base = new THREE.Mesh(geoBase, matBase);
base.position.set(0, 0.15, 0);
base.castShadow = true;
base.receiveShadow = true;
scene.add(base);

// Rotating orb
const geoOrb = new THREE.SphereGeometry(0.7, 32, 32);
const matOrb = new THREE.MeshStandardNodeMaterial({ roughness: 0.2, metalness: 0.8 });
const { color: tslColor, time, oscSine } = tsl;
matOrb.colorNode = tslColor(0x88aaff).mul(oscSine(time.mul(0.8)).remapClamp(0, 1, 0.6, 1.4));
const orb = new THREE.Mesh(geoOrb, matOrb);
orb.position.set(0, 1.2, 0);
orb.castShadow = true;
scene.add(orb);

// Canvas label
const tex = stdlib.makeCanvasTexture("Ask the agent to regenerate this scene", {
  bg: "#0d1117", fg: "#8080c0", font: "bold 32px sans-serif", w: 512, h: 128
});
const sign = new THREE.Mesh(
  new THREE.PlaneGeometry(4, 1),
  new THREE.MeshStandardMaterial({ map: tex, side: 2 })
);
sign.position.set(0, 2.5, 0);
sign.lookAt(0, 2.5, 5);
scene.add(sign);

// Ground
const ground = stdlib.makeTerrain("floor", { width: 40, depth: 40 });
scene.add(ground);

animate((delta) => { orb.rotation.y += delta * 0.8; });
`;

export class SceneRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGPURenderer;
  private controls: OrbitControls;
  private pointerLock!: PointerLockControls;
  private fpActive = false;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private postProcessing!: THREE.PostProcessing;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private bloomNode!: any; // BloomNode — access .strength.value / .radius.value / .threshold.value
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private aoNode!: any;    // GTAONode — access .radius.value / .distanceExponent.value
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private scenePass: any = null; // PassNode — created once with MRT, reused across tier changes
  private sunDir = new THREE.Vector3(0, 1, 0); // updated per scene
  private sky: SkyMesh;
  // Persistent world ground plane and background ridges — hidden for indoor scenes,
  // restored to visible at the start of each new scene load.
  private worldGroundMesh: THREE.Object3D | null = null;
  private worldRidgeMeshes: THREE.Object3D[] = [];
  private canvas: HTMLCanvasElement;
  private initPromise: Promise<void> | null = null;
  private disposed = false;
  // Group that owns everything added by sceneCode — cleared on every loadScene()
  private codeGroup = new THREE.Group();
  // Ambient scatter props (rocks) regenerated per outdoor scene load
  private scatterGroup = new THREE.Group();
  private objects = new Map<string, THREE.Object3D>(); // objectId → root
  private objectMeta = new Map<string, SceneObject>();
  private loopRunning = false;
  private animSystems: AnimSystem[] = [];
  private raycaster = new THREE.Raycaster();
  private lastFrameTime = 0;

  // Smooth transition state
  private transitionStart = 0;
  private transitionFrom = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private transitionTo   = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private transitioning  = false;
  // Set to true by OrbitControls "start" event (user begins interaction).
  // Reset to false once controls.update() returns false (damping fully settled).
  // Prevents controls.update() from running every frame in demand-render mode,
  // which accumulates floating-point residual and causes continuous camera drift.
  private controlsNeedsUpdate = false;

  // ── WASD keyboard movement ────────────────────────────────────────────────
  private keysDown = new Set<string>();
  private readonly wasdSpeed = 10; // units per second
  private readonly wasdFwd   = new THREE.Vector3();
  private readonly wasdRight = new THREE.Vector3();
  private readonly wasdUp_   = new THREE.Vector3(0, 1, 0);
  private readonly wasdMove  = new THREE.Vector3();
  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.keysDown.add(e.key.toLowerCase());
  };
  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keysDown.delete(e.key.toLowerCase());
  };

  // ── Demand rendering (R3F-style frameloop:"demand") ──────────────────────
  // framesDue > 0 → render this frame and decrement.
  // Always render when animSystems are active (animated scenes like Water).
  private framesDue = 0;

  // ── Dynamic quality tier (0=LOW, 1=MEDIUM, 2=HIGH) ──────────────────────
  // Tier transitions rebuild the full PostProcessing pipeline so expensive
  // GPU passes (GTAO, SMAA, grain) are truly skipped — not just blended away.
  //
  //  HIGH   (2): GTAO + bloom + SMAA + grain + vignette,  DPR ×1.0
  //  MEDIUM (1): no GTAO,       bloom + SMAA,             DPR ×0.75
  //  LOW    (0): no GTAO/SMAA,  bloom only,               DPR ×0.5
  //
  // Asymmetric cooldowns prevent thrashing: fast downgrade, slow upgrade.
  private qualityTier = 2;
  private readonly frameSamples: number[] = [];  // rolling GPU frame-time window
  private readonly frameSampleMax = 10;
  private lastTierChange = 0;
  private readonly tierDownCooldown = 2000;  // ms: minimum gap between downgrades
  private readonly tierUpCooldown   = 8000;  // ms: minimum gap between upgrades
  // Bloom params cached here so they survive pipeline rebuilds on tier change
  private bloomParams = { strength: 0.2, radius: 0.2, threshold: 1.1 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 30, 90);

    this.camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 500);
    this.camera.position.set(0, 8, 20);
    this.camera.lookAt(0, 0, 0);

    // WebGPU has native MSAA — antialias:true works fine without EffectComposer conflict
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    // Guard against zero-size canvas at construction (happens before CSS layout finishes)
    this.renderer.setSize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;

    // OrbitControls for free camera exploration
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.18;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 200;
    this.controls.addEventListener("change", () => this.invalidate(1));
    // Mark controls as needing update when user starts interacting, so update() runs
    // each frame until damping fully settles. Without this guard, update() runs every
    // frame in the demand-render loop and accumulated float residual causes camera drift.
    this.controls.addEventListener("start",  () => { this.controlsNeedsUpdate = true; });

    // PointerLockControls for first-person walk mode
    this.pointerLock = new PointerLockControls(this.camera, document.body);
    this.pointerLock.addEventListener("lock", () => {
      this.fpActive = true;
      this.controls.enabled = false;
      // Lower camera to eye level (1.7 units) if currently orbiting high above
      if (this.camera.position.y > 3) {
        this.camera.position.y = 1.7;
      }
    });
    this.pointerLock.addEventListener("unlock", () => {
      this.fpActive = false;
      this.controls.enabled = true;
      // Sync OrbitControls target to where the camera is facing
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.controls.target.copy(this.camera.position).addScaledVector(dir, 5);
      this.controlsNeedsUpdate = true;
    });

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup",   this.onKeyUp);

    // Lights — will be overridden by loadScene() env settings
    this.hemi = new THREE.HemisphereLight(0x87ceeb, 0x4a7c59, 0.6);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
    this.sun.position.set(30, 50, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.camera.left = -40;
    this.sun.shadow.camera.right = 40;
    this.sun.shadow.camera.top = 40;
    this.sun.shadow.camera.bottom = -40;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 200;
    this.sun.shadow.bias = -0.001;
    this.scene.add(this.sun);

    this.setupGround();
    this.setupWorldRidge();
    this.scene.add(this.codeGroup);
    this.scene.add(this.scatterGroup);

    // Atmospheric sky (Preetham model) — always in scene; toggled per preset
    this.sky = new SkyMesh();
    this.sky.scale.setScalar(450000);
    this.sky.visible = false; // hidden until loadScene() activates it
    this.scene.add(this.sky);
  }

  /** Must be called after construction. Initialises WebGPU, environment, post-processing, and starts the loop. */
  async init(): Promise<void> {
    this.initPromise = (async () => {
      await this.renderer.init();
      if (this.disposed) return; // React Strict Mode cleanup may have run during await

      // After the async wait, CSS layout has completed — set the real canvas dimensions
      const w = Math.max(1, this.canvas.clientWidth);
      const h = Math.max(1, this.canvas.clientHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.setSize(w, h);

      // HDRI environment — baseline: RoomEnvironment (no network, immediate).
      // Per-scene: replaced by a Polyhaven 1k HDRI in loadScene() once loaded.
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
      pmrem.dispose();

      this.buildPostProcessing(this.qualityTier);
      this.setupResizeObserver(this.canvas);
      this.startLoop();
    })();
    return this.initPromise;
  }

  private buildPostProcessing(tier: number): void {
    // Create the scene pass exactly once with MRT (2 color targets: output + normalView).
    // MRT must NEVER change after first render — WebGPU compiles material render pipelines
    // with the attachment state baked in. Recreating the pass with different MRT
    // causes attachment-state mismatch errors (pipeline has 2 targets, pass expects 1).
    // Lower tiers simply ignore the normal output; they don't remove it.
    if (!this.scenePass) {
      this.scenePass = pass(this.scene, this.camera);
      this.scenePass.setMRT(mrt({ output, normal: normalView }));
    }

    const sceneColor  = this.scenePass.getTextureNode("output");
    const sceneNormal = this.scenePass.getTextureNode("normal");
    const sceneDepth  = this.scenePass.getTextureNode("depth");

    let baseColor;
    if (tier >= 2) {
      // ── HIGH: GTAO ambient occlusion multiplied on top of scene color ──────
      this.aoNode = ao(sceneDepth, sceneNormal, this.camera);
      this.aoNode.resolutionScale       = 0.25;
      this.aoNode.radius.value          = 0.25;
      this.aoNode.distanceExponent.value = 1.0;
      this.aoNode.samples.value         = 6;
      baseColor = sceneColor.mul(this.aoNode.getTextureNode("ao"));
    } else {
      this.aoNode = null;
      baseColor = sceneColor;
    }

    this.bloomNode = bloom(baseColor, this.bloomParams.strength, this.bloomParams.radius, this.bloomParams.threshold);
    const withBloom = baseColor.add(this.bloomNode);

    let outputNode;
    if (tier >= 2) {
      // HIGH: SMAA + film grain + vignette
      const withGrain = film(smaa(withBloom), 0.04);
      const vignette  = uv().sub(0.5).length().mul(1.55).smoothstep(0.8, 0.15).mul(0.24).add(0.76);
      outputNode = withGrain.mul(vignette);
    } else if (tier === 1) {
      // MEDIUM: SMAA only
      outputNode = smaa(withBloom);
    } else {
      // LOW: bloom only
      outputNode = withBloom;
    }

    // Reuse existing PostProcessing if available — avoids disposing compiled passes.
    // Only create a new instance on first call (this.postProcessing is uninitialized).
    if (!this.postProcessing) {
      this.postProcessing = new THREE.PostProcessing(this.renderer);
    }
    this.postProcessing.outputNode = outputNode;
  }

  /** Register a per-frame system. Systems are kept sorted by priority (ascending). */
  private registerSystem(priority: number, tick: (delta: number) => void): void {
    const system: AnimSystem = { priority, tick };
    const idx = this.animSystems.findIndex(s => s.priority > priority);
    if (idx === -1) {
      this.animSystems.push(system);
    } else {
      this.animSystems.splice(idx, 0, system);
    }
  }

  async loadScene(data: SceneData): Promise<void> {
    // Ensure WebGPU renderer is fully initialized before touching post-processing uniforms
    if (this.initPromise) await this.initPromise;

    // Remove JSON-built objects
    for (const obj of this.objects.values()) {
      this.scene.remove(obj);
    }
    this.objects.clear();
    this.objectMeta.clear();
    this.animSystems = [];

    // Remove all objects added by previous sceneCode execution
    this.codeGroup.clear();
    // Clear per-scene ambient scatter (rocks, shrubs)
    this.clearScatter();
    // Restore fog in case previous sceneCode set scene.fog = null
    if (!this.scene.fog) {
      this.scene.fog = new THREE.Fog(0x87ceeb, 30, 90);
    }

    // Apply environment settings first (needed for bloom boost logic)
    const env = data.environment ?? {};
    const preset = resolveEnvPreset(env.skybox, env.timeOfDay);

    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.set(preset.fogColor);
      fog.near = 30;
      fog.far  = 90;
    }

    this.hemi.color.set(preset.skyColor);
    this.hemi.groundColor.set(preset.groundColor);
    this.hemi.intensity = preset.ambientIntensity;

    this.sun.color.set(preset.sunColor);
    this.sun.intensity = preset.sunIntensity;

    if (env.skyboxUrl) {
      // Equirectangular panorama from Matrix-3D or similar — highest priority, replaces procedural sky
      this.sky.visible = false;
      this.scene.background = null;
      this.sunDir.set(0, -1, 0); // disable god rays (panorama supplies its own lighting)
      this.sun.position.set(...preset.sunPosition);
      const panoUrl = env.skyboxUrl;
      new THREE.TextureLoader().load(panoUrl, (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = tex;
        this.scene.environment = tex; // IBL from the panorama
        this.invalidate(2);
      });
    } else if (preset.sky !== null) {
      // Outdoor / atmospheric sky — activate Three.Sky shader
      this.sky.visible = true;
      this.scene.background = null;

      const skyUniforms = (this.sky as unknown as { turbidity: { value: number }; rayleigh: { value: number }; mieCoefficient: { value: number }; mieDirectionalG: { value: number }; sunPosition: { value: THREE.Vector3 } });
      skyUniforms.turbidity.value        = preset.sky.turbidity;
      skyUniforms.rayleigh.value         = preset.sky.rayleigh;
      skyUniforms.mieCoefficient.value   = preset.sky.mieCoefficient;
      skyUniforms.mieDirectionalG.value  = preset.sky.mieDirectionalG;

      // Compute sun direction from elevation + azimuth angles
      const phi = THREE.MathUtils.degToRad(90 - preset.sky.elevation);
      const theta = THREE.MathUtils.degToRad(preset.sky.azimuth);
      const sunDir = new THREE.Vector3();
      sunDir.setFromSphericalCoords(1, phi, theta);
      skyUniforms.sunPosition.value.copy(sunDir);
      this.sunDir.copy(sunDir);  // save for sun direction tracking

      // Position the directional light to match the sky sun
      this.sun.position.copy(sunDir.clone().multiplyScalar(100));
    } else {
      // Night / indoor — hide sky mesh, show flat background colour; disable god rays
      this.sky.visible = false;
      this.scene.background = new THREE.Color(preset.skyColor);
      this.sun.position.set(...preset.sunPosition);
      this.sunDir.set(0, -1, 0); // below horizon → uVisible will be 0
    }

    // Apply bloom settings from environment.effects
    const bloomCfg = env.effects?.bloom;
    const baseStrength = bloomCfg?.strength ?? 0.2;
    const isNight = env.skybox === "night" || env.timeOfDay === "night";
    this.bloomParams.strength  = isNight ? Math.max(baseStrength, 0.8) : baseStrength;
    this.bloomParams.radius    = bloomCfg?.radius ?? 0.2;
    this.bloomParams.threshold = bloomCfg?.threshold ?? 1.1;
    this.bloomNode.strength.value  = this.bloomParams.strength;
    this.bloomNode.radius.value    = this.bloomParams.radius;
    // Threshold 1.1: only pixels that exceed 1.1 in HDR space bloom.
    this.bloomNode.threshold.value = this.bloomParams.threshold;

    // Upgrade scene.environment from RoomEnvironment baseline to a real Polyhaven
    // HDRI matched to the skybox preset.  Fire-and-forget: the baseline keeps
    // things looking reasonable while the ~200 KB 1k .hdr downloads.
    // Skip for panorama-URL scenes — stdlib.setupLighting() handles HDRI for sceneCode scenes.
    if (env.skybox && !env.skyboxUrl && !data.sceneCode) {
      const skyboxKey = env.skybox;
      // IBL: upgrade reflections / shading quality with PMREM HDR
      loadEnvMap(skyboxKey, this.renderer)
        .then((envMap) => {
          this.scene.environment = envMap;
          this.invalidate(2);
        })
        .catch(() => {
          // Network unavailable — RoomEnvironment baseline remains active
        });
      // Background: replace procedural Sky shader with photorealistic JPEG panorama.
      // Sky shader shows instantly; JPEG swaps in when loaded (typically < 1 s cached).
      if (preset.sky !== null) {
        loadSkyBackground(skyboxKey)
          .then((bgTex) => {
            this.sky.visible = false;
            this.scene.background = bgTex;
            this.invalidate(2);
          })
          .catch(() => {
            // Network unavailable — procedural Sky shader remains visible
          });
      }
    }

    // All scenes use sceneCode. stdlib.setupLighting() takes full control of
    // scene illumination — mute renderer's built-in lights so they don't conflict.
    // Disable this.sun.castShadow: stdlib's outdoor sun (tagged userData.isSun=true)
    // is the authoritative shadow caster for sceneCode scenes — it uses the skybox-
    // matched sun direction and a validated 4k shadow map. Having two DirectionalLights
    // both casting shadows would double the shadow cost and produce conflicting directions.
    // Hide the SkyMesh — sceneCode uses stdlib.setupLighting() for sky which sets
    // scene.background directly (flat color → HDRI JPEG). SkyMesh visible on top
    // of scene.background would obscure the Polyhaven sky texture.
    this.sky.visible = false;
    this.hemi.intensity = 0;
    this.sun.intensity = 0;
    this.sun.castShadow = false;
    // sceneCode is responsible for its own ground geometry. Hide the persistent
    // world ground plane so it doesn't z-fight with sceneCode-generated floors.
    if (this.worldGroundMesh) this.worldGroundMesh.visible = false;
    for (const r of this.worldRidgeMeshes) r.visible = false;
    this.executeCode(data.sceneCode ?? DEFAULT_SCENE_CODE);
    this.invalidate(2);
  }

  executeCode(code: string): void {
    this.animSystems = [];

    // Proxy wraps codeGroup so that scene.add() / scene.remove() target the group,
    // but scene.background / scene.fog / scene.environment still reach the real Scene.
    const sceneProxy = new Proxy(this.codeGroup, {
      get: (target, prop) => {
        if (prop === "add" || prop === "remove" || prop === "children") {
          return typeof target[prop as keyof typeof target] === "function"
            ? (target[prop as keyof typeof target] as (...a: unknown[]) => unknown).bind(target)
            : target[prop as keyof typeof target];
        }
        const val = (this.scene as unknown as Record<string | symbol, unknown>)[prop as string | symbol];
        return typeof val === "function" ? val.bind(this.scene) : val;
      },
      set: (_target, prop, value) => {
        (this.scene as unknown as Record<string | symbol, unknown>)[prop as string | symbol] = value;
        return true;
      },
    });

    const stdlib = createStdlib(
      this.scene,
      this.camera,
      this.renderer,
      (cb: (delta: number) => void) => { this.registerSystem(SystemOrder.Render, cb); },
      (n?: number) => { this.invalidate(n); },
      (v: boolean) => {
        if (this.worldGroundMesh) this.worldGroundMesh.visible = v;
        for (const r of this.worldRidgeMeshes) r.visible = v;
      },
    );

    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(
        "THREE", "tsl", "scene", "camera", "renderer", "controls", "animate", "WaterMesh", "stdlib",
        code,
      );
      fn(
        THREE,
        TSL,
        sceneProxy,
        this.camera,
        this.renderer,
        this.controls,
        (cb: (delta: number) => void) => { this.registerSystem(SystemOrder.Render, cb); },
        WaterMesh,
        stdlib,
      );
    } catch (err) {
      console.error("[SceneRenderer] sceneCode execution error:", err);
    }

    // Force-disable shadow casting on every light placed by sceneCode EXCEPT the stdlib sun.
    // SpotLight / PointLight shadows cause shadow-map flickering artifacts when the camera
    // moves and consume WebGPU texture slots. AI-generated DirectionalLights may have
    // bad frustum settings. Only stdlib.setupLighting()'s outdoor sun (tagged with
    // userData.isSun = true) is trusted and allowed to cast shadows — it has a validated
    // 4 k shadow map, correct ±40 frustum, and the right position for the active skybox.
    this.codeGroup.traverse((child) => {
      const light = child as THREE.Light;
      if (light.isLight && light.castShadow && !light.userData["isSun"]) {
        light.castShadow = false;
      }
    });

    // Tighter bloom for indoor scenes. stdlib.setupLighting({ isIndoor: true })
    // writes scene.userData["isIndoor"]; if not set, fall back to detecting PointLights
    // in codeGroup (a reliable indoor indicator since outdoor stdlib uses DirectionalLight only).
    const isIndoor = !!this.scene.userData["isIndoor"] || (() => {
      let hasPoint = false;
      this.codeGroup.traverse((c) => { if ((c as THREE.PointLight).isPointLight) hasPoint = true; });
      return hasPoint;
    })();
    if (isIndoor) {
      this.bloomParams.strength  = 0.12;
      this.bloomParams.radius    = 0.05;
      this.bloomParams.threshold = 1.3;
      this.bloomNode.strength.value  = this.bloomParams.strength;
      this.bloomNode.radius.value    = this.bloomParams.radius;
      this.bloomNode.threshold.value = this.bloomParams.threshold;
    }
  }

  goToViewpoint(viewpoint: Viewpoint): void {
    this.transitionFrom.pos.copy(this.camera.position);
    this.transitionFrom.target.copy(this.controls.target);

    this.transitionTo.pos.set(viewpoint.position.x, viewpoint.position.y, viewpoint.position.z);
    this.transitionTo.target.set(viewpoint.lookAt.x, viewpoint.lookAt.y, viewpoint.lookAt.z);

    this.transitionStart = performance.now();
    this.transitioning = true;
    this.invalidate(Math.ceil(TRANSITION_DURATION / 16) + 4);
  }

  // Returns the first interactable object under the pointer, or null
  pick(ndcX: number, ndcY: number): PickResult | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const allMeshes: THREE.Object3D[] = [];
    for (const root of this.objects.values()) {
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) allMeshes.push(child);
      });
    }
    const hits = this.raycaster.intersectObjects(allMeshes);
    if (!hits.length) return null;

    const objectId = hits[0].object.userData.objectId as string | undefined;
    if (!objectId) return null;

    const meta = this.objectMeta.get(objectId);
    if (!meta) return null;

    return {
      objectId,
      name: meta.name,
      interactable: meta.interactable,
      interactionHint: meta.interactionHint,
    };
  }

  highlightObject(objectId: string | null): void {
    for (const [id, root] of this.objects) {
      const emissive = id === objectId && objectId !== null ? 0x444400 : 0x000000;
      root.traverse((child) => {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (mat?.emissive) mat.emissive.set(emissive);
      });
    }
    this.invalidate(2);
  }

  /** Queue N frames to render. Call whenever the scene visually changes. */
  invalidate(frames = 2): void {
    this.framesDue = Math.max(this.framesDue, frames);
  }

  /** Enter first-person walk mode (PointerLock). Browser requires a user gesture. */
  enterPointerLock(): void {
    if (!this.pointerLock.isLocked) this.pointerLock.lock();
  }

  get isPointerLocked(): boolean {
    return this.fpActive;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.renderer.setAnimationLoop(null); } catch (_) { /* not yet initialized */ }
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup",   this.onKeyUp);
    this.keysDown.clear();
    this.controls.dispose();
    if (this.pointerLock.isLocked) this.pointerLock.unlock();
    this.pointerLock.dispose();
    try { this.renderer.dispose(); } catch (_) { /* backend may be uninitialized */ }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /**
   * Switch to a new quality tier. Rebuilds the PostProcessing pipeline so
   * expensive GPU passes are truly skipped, and adjusts DPR accordingly.
   *  2 = HIGH:   GTAO + bloom + SMAA + grain + vignette, DPR ×1.0
   *  1 = MEDIUM: bloom + SMAA,                           DPR ×0.75
   *  0 = LOW:    bloom only,                             DPR ×0.5
   */
  private setQualityTier(tier: number): void {
    this.qualityTier = tier;
    this.lastTierChange = performance.now();
    this.frameSamples.length = 0; // reset window after any tier change

    // Rebuild pipeline for the new tier
    this.buildPostProcessing(tier);

    // Reapply stored bloom params to the freshly created bloomNode
    this.bloomNode.strength.value  = this.bloomParams.strength;
    this.bloomNode.radius.value    = this.bloomParams.radius;
    this.bloomNode.threshold.value = this.bloomParams.threshold;

    // Adjust DPR: lower tiers reduce pixel count to save fillrate
    const dprScale = tier >= 2 ? 1.0 : tier === 1 ? 0.75 : 0.5;
    const el = this.renderer.domElement;
    this.renderer.setPixelRatio(window.devicePixelRatio * dprScale);
    this.renderer.setSize(el.clientWidth, el.clientHeight, false);
    this.invalidate(2);

    const label = ["LOW", "MEDIUM", "HIGH"][tier] ?? tier;
    console.info(`[SceneRenderer] quality tier → ${label} (DPR ×${dprScale})`);
  }

  /**
   * Called each frame with the GPU render time (ms).
   * Maintains a rolling window and adjusts quality tier as needed.
   *
   * Downgrade: p75 > 33ms (< 30 fps)  with tierDownCooldown guard
   * Upgrade:   p75 < 20ms (> 50 fps)  with tierUpCooldown guard
   */
  private evaluateQualityTier(frameMs: number): void {
    this.frameSamples.push(frameMs);
    if (this.frameSamples.length > this.frameSampleMax) {
      this.frameSamples.shift();
    }
    // Need a full window before drawing conclusions
    if (this.frameSamples.length < this.frameSampleMax) return;

    const sorted = [...this.frameSamples].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    const now = performance.now();

    if (p75 > 33 && this.qualityTier > 0 && now - this.lastTierChange > this.tierDownCooldown) {
      this.setQualityTier(this.qualityTier - 1);
    } else if (p75 < 20 && this.qualityTier < 2 && now - this.lastTierChange > this.tierUpCooldown) {
      this.setQualityTier(this.qualityTier + 1);
    }
  }

  private setupGround(): void {
    // 64-segment subdivision so vertex displacement produces smooth hills
    const segs = 64;
    const geo = new THREE.PlaneGeometry(300, 300, segs, segs);

    // Displace vertices: flat within 20 units of centre (safe for object placement),
    // then gently undulate outward — breaks the "tabletop" flatness.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);                            // Y = depth axis before rotation
      const r  = Math.sqrt(px * px + py * py);
      const blend = THREE.MathUtils.smoothstep(20, 65, r);
      const h =
        Math.sin(px * 0.08) * Math.cos(py * 0.06) * 1.8 +
        Math.sin(px * 0.15 + 1.3) * Math.sin(py * 0.12 + 0.8) * 0.9 +
        Math.cos(px * 0.04 - 0.7) * Math.sin(py * 0.05) * 1.2;
      pos.setZ(i, h * blend);                            // Z → world Y after -PI/2 rotation
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    setupUv2(geo);

    const mat = new THREE.MeshStandardMaterial({ color: 0x5a7a3a, roughness: 1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.worldGroundMesh = ground;
    applyTerrainPbr(mat, "aerial_grass_rock", 50, () => this.invalidate(2), 0.06);
  }

  /**
   * Permanent horizon backdrop: 6 hills in a broad arc at z = -42 to -55.
   * At typical camera position z ≈ 14, these are 56–69 units away — well inside
   * the fog range (near=30, far=90) so they appear as soft atmospheric silhouettes.
   * Never cleared between scene loads; always present to give the world an "edge".
   */
  private setupWorldRidge(): void {
    // [x, z, width, height]
    const configs: [number, number, number, number][] = [
      [-52, -48, 38, 18],
      [-18, -52, 32, 14],
      [ 16, -55, 36, 16],
      [ 50, -50, 30, 12],
      [-34, -42, 26, 10],
      [ 34, -44, 28, 11],
    ];
    for (const [rx, rz, rw, rh] of configs) {
      const geo = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
      setupUv2(geo);
      const mat = makeTerrainSlopeMat(0x3d6630, 0x5a4830, 0.3, 0.7);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(rw, rh, rw * 0.72);   // slightly shallower depth = realistic ridge shape
      mesh.position.set(rx, -rh * 0.05, rz);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.worldRidgeMeshes.push(mesh);
      applyTerrainPbrNode(mat, "aerial_grass_rock", 4, 0x3d6630, 0x5a4830, 0.3, 0.7, () => this.invalidate(2));
    }
  }

  /** Dispose GPU resources of everything in scatterGroup, then clear it. */
  private clearScatter(): void {
    this.scatterGroup.traverse((child) => {
      const im = child as THREE.InstancedMesh;
      if (!im.isInstancedMesh) return;
      im.geometry.dispose();
      const mats = Array.isArray(im.material) ? im.material : [im.material];
      mats.forEach((m) => m.dispose());
    });
    this.scatterGroup.clear();
  }

  /**
   * Scatter ambient rocks in an annular zone (r = 18–50) around the scene.
   * Skips indoor scenes (detected by presence of a wall terrain object).
   * Uses a seeded RNG so placement is deterministic per-scene.
   */
  private setupResizeObserver(canvas: HTMLCanvasElement): void {
    const observer = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(window.devicePixelRatio * (this.qualityTier >= 2 ? 1.0 : this.qualityTier === 1 ? 0.75 : 0.5));
      this.renderer.setSize(w, h, false);
      // PostProcessing resizes automatically with renderer.setSize()
      this.invalidate(2);
    });
    observer.observe(canvas);
  }

  private startLoop(): void {
    if (this.loopRunning) return;
    this.loopRunning = true;

    this.renderer.setAnimationLoop(async (now: number) => {
      const delta = this.lastFrameTime > 0 ? (now - this.lastFrameTime) / 1000 : 0;
      this.lastFrameTime = now;

      // ── WASD movement ─────────────────────────────────────────────────────
      if (this.keysDown.size > 0 && !this.transitioning && delta > 0) {
        const activeEl = document.activeElement;
        const inputActive =
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement;
        if (!inputActive) {
          const sprint = this.keysDown.has("shift") ? 3 : 1;
          const spd = sprint * this.wasdSpeed * Math.min(delta, 0.1);

          if (this.fpActive) {
            // FP mode: PointerLockControls handles mouse look; WASD moves in camera direction
            const fwd = this.keysDown.has("w") || this.keysDown.has("arrowup");
            const bck = this.keysDown.has("s") || this.keysDown.has("arrowdown");
            const lft = this.keysDown.has("a") || this.keysDown.has("arrowleft");
            const rgt = this.keysDown.has("d") || this.keysDown.has("arrowright");
            if (fwd) this.pointerLock.moveForward(spd);
            if (bck) this.pointerLock.moveForward(-spd);
            if (lft) this.pointerLock.moveRight(-spd);
            if (rgt) this.pointerLock.moveRight(spd);
            // Keep camera at eye level (prevent vertical drift from FP movement)
            if (fwd || bck || lft || rgt) this.camera.position.y = Math.max(0.5, this.camera.position.y);
            this.invalidate(1);
          } else {
            this.camera.getWorldDirection(this.wasdFwd);
            this.wasdFwd.y = 0;
            if (this.wasdFwd.lengthSq() > 0.0001) this.wasdFwd.normalize();
            this.wasdRight.crossVectors(this.wasdFwd, this.wasdUp_).normalize();

            this.wasdMove.set(0, 0, 0);
            if (this.keysDown.has("w") || this.keysDown.has("arrowup"))    this.wasdMove.addScaledVector(this.wasdFwd,  spd);
            if (this.keysDown.has("s") || this.keysDown.has("arrowdown"))  this.wasdMove.addScaledVector(this.wasdFwd, -spd);
            if (this.keysDown.has("a") || this.keysDown.has("arrowleft"))  this.wasdMove.addScaledVector(this.wasdRight, -spd);
            if (this.keysDown.has("d") || this.keysDown.has("arrowright")) this.wasdMove.addScaledVector(this.wasdRight,  spd);

            if (this.wasdMove.lengthSq() > 0) {
              this.camera.position.add(this.wasdMove);
              this.controls.target.add(this.wasdMove);
              this.controlsNeedsUpdate = true;
              this.invalidate(1);
            }
          }
        }
      }

      // In FP mode, always render so mouse-look feels responsive
      if (this.fpActive) this.invalidate(1);

      // Smooth camera transition. Camera position is lerped directly, then
      // controls.update() syncs OrbitControls' internal spherical state.
      if (this.transitioning) {
        const elapsed = performance.now() - this.transitionStart;
        const t = Math.min(elapsed / TRANSITION_DURATION, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        this.camera.position.lerpVectors(this.transitionFrom.pos, this.transitionTo.pos, eased);
        this.controls.target.lerpVectors(this.transitionFrom.target, this.transitionTo.target, eased);
        if (t >= 1) {
          this.transitioning = false;
          // Two flush calls: first re-derives spherical from final camera position;
          // second applies (near-zero) delta and fully settles internal state.
          this.controls.update();
          this.controls.update();
        } else {
          // Sync spherical state to the lerped camera position each in-progress frame.
          this.controls.update();
        }
        this.invalidate(1);
      } else if (!this.fpActive && this.controlsNeedsUpdate) {
        // Apply damping after user input until OrbitControls fully settles.
        // update() returns false once the camera stops moving — clear the flag then.
        const moved = this.controls.update();
        if (!moved) this.controlsNeedsUpdate = false;
      }
      // No controls.update() outside the two branches above: calling it every frame
      // in a demand-render loop lets floating-point residual accumulate and drift the
      // camera continuously — visible as slow upward tilt even without user input.

      // Per-frame systems — run in ascending priority order
      const hasSystems = this.animSystems.length > 0;
      for (let i = 0; i < this.animSystems.length; i++) {
        try {
          this.animSystems[i].tick(delta);
        } catch (err) {
          console.warn("[SceneRenderer] animSystem error (priority=%d):", this.animSystems[i].priority, err);
          this.animSystems.splice(i, 1);
          i--;
        }
      }
      // Animated scenes always need the next frame
      if (hasSystems) this.invalidate(1);

      // ── Demand render ─────────────────────────────────────────────────────
      // Only call renderAsync when work is queued.
      if (this.framesDue <= 0) return;
      this.framesDue--;

      // Adaptive DPR: measure frame time; regress on overrun
      const frameStart = performance.now();
      try {
        await this.postProcessing.renderAsync();
      } catch (err) {
        console.error("[SceneRenderer] render error:", err);
      }
      const frameMs = performance.now() - frameStart;
      this.evaluateQualityTier(frameMs);
    });
  }
}
