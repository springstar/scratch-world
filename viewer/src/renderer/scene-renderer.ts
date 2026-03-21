import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { SceneData, SceneObject, Viewpoint } from "../types.js";

// Colour palette keyed by object type
const TYPE_COLORS: Record<string, number> = {
  building: 0x8b7355,
  terrain: 0x4a7c59,
  tree: 0x2d5a27,
  npc: 0xe8c97e,
  item: 0xd4af37,
  object: 0x9b9b9b,
};
const FALLBACK_COLOR = 0xaaaaaa;

function colorFor(type: string): number {
  return TYPE_COLORS[type] ?? FALLBACK_COLOR;
}

function makeMat(color: number, rough = 0.8, metal = 0.1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function inferShape(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("blackboard") || n.includes("chalkboard")) return "blackboard";
  if (n.includes("desk") || n.includes("table")) return "desk";
  if (n.includes("chair") || n.includes("stool") || n.includes("seat")) return "chair";
  if (n.includes("window")) return "window";
  if (n.includes("door")) return "door";
  if (n.includes("wall")) return "wall";
  if (n.includes("court") || n.includes("hardwood")) return "court";
  if (n.includes("floor") || n.includes("ceiling")) return "floor";
  if (n.includes("shelf") || n.includes("bookcase")) return "shelf";
  if (n.includes("pillar") || n.includes("column")) return "pillar";
  if (n.includes("hoop") || n.includes("basket") || n.includes("rim")) return "hoop";
  return "box";
}

function buildObjectByShape(
  obj: SceneObject,
  x: number,
  y: number,
  z: number,
): THREE.Object3D {
  const shape = (obj.metadata.shape as string | undefined) ?? inferShape(obj.name);
  const state = obj.metadata.state as string | undefined;

  switch (shape) {
    case "blackboard":
    case "chalkboard": {
      const group = new THREE.Group();
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(4, 2.5, 0.1),
        makeMat(0x1a3a2a, 0.9, 0),
      );
      board.position.y = 1.5;
      board.castShadow = true;
      board.receiveShadow = true;
      group.add(board);
      // Chalk writing — thin plane on the front face, hidden when erased
      if (state !== "erased" && state !== "clean") {
        const chalk = new THREE.Mesh(
          new THREE.PlaneGeometry(3.4, 2.0),
          new THREE.MeshStandardMaterial({ color: 0xddeedd, roughness: 1, metalness: 0, opacity: 0.55, transparent: true }),
        );
        chalk.position.set(0, 1.5, 0.056);
        group.add(chalk);
      }
      group.position.set(x, y, z);
      return group;
    }

    case "desk":
    case "table": {
      const group = new THREE.Group();
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.06, 0.7),
        makeMat(0xc8a46e, 0.7, 0),
      );
      top.position.y = 0.76;
      top.castShadow = true;
      top.receiveShadow = true;
      group.add(top);
      for (const [lx, lz] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]] as [number, number][]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, 0.76, 6),
          makeMat(0xb08050, 0.8, 0),
        );
        leg.position.set(lx, 0.38, lz);
        group.add(leg);
      }
      group.position.set(x, y, z);
      return group;
    }

    case "chair":
    case "stool": {
      const group = new THREE.Group();
      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.05, 0.45),
        makeMat(0xb08050, 0.8, 0),
      );
      seat.position.y = 0.45;
      group.add(seat);
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.5, 0.04),
        makeMat(0xb08050, 0.8, 0),
      );
      back.position.set(0, 0.73, -0.22);
      group.add(back);
      for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]] as [number, number][]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6),
          makeMat(0x8b6040, 0.9, 0),
        );
        leg.position.set(lx, 0.225, lz);
        group.add(leg);
      }
      group.position.set(x, y, z);
      return group;
    }

    case "window": {
      const group = new THREE.Group();
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 2.0, 0.1),
        makeMat(0xd4c5a0, 0.8, 0),
      );
      frame.position.y = 1.4;
      group.add(frame);
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 1.8, 0.04),
        new THREE.MeshStandardMaterial({ color: 0xadd8e6, roughness: 0.05, metalness: 0.1, opacity: 0.45, transparent: true, emissive: 0x88aacc, emissiveIntensity: 0.3 }),
      );
      glass.position.y = 1.4;
      group.add(glass);
      group.position.set(x, y, z);
      return group;
    }

    case "door": {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 2.1, 0.08),
        makeMat(0x8b6040, 0.8, 0),
      );
      mesh.position.set(x, y + 1.05, z);
      return mesh;
    }

    case "wall": {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(8, 3, 0.2),
        makeMat(0xe8e0d0, 0.95, 0),
      );
      mesh.position.set(x, y + 1.5, z);
      mesh.receiveShadow = true;
      return mesh;
    }

    case "floor":
    case "ceiling": {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(20, 0.15, 20),
        makeMat(shape === "ceiling" ? 0xf5f0e8 : 0xc8b89a, 1, 0),
      );
      mesh.position.set(x, shape === "ceiling" ? y + 3 : y + 0.075, z);
      mesh.receiveShadow = true;
      return mesh;
    }

    case "shelf":
    case "bookcase": {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 2.0, 0.35),
        makeMat(0xc8a46e, 0.8, 0),
      );
      body.position.y = 1.0;
      group.add(body);
      group.position.set(x, y, z);
      return group;
    }

    case "pillar":
    case "column": {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 3, 8),
        makeMat(0xd4ccc0, 0.9, 0),
      );
      mesh.position.set(x, y + 1.5, z);
      return mesh;
    }

    case "hoop": {
      const group = new THREE.Group();
      // Support pole
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 3.5, 8),
        makeMat(0x888888, 0.6, 0.4),
      );
      pole.position.y = 1.75;
      group.add(pole);
      // Horizontal arm from pole to backboard
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.06, 0.06),
        makeMat(0x888888, 0.6, 0.4),
      );
      arm.position.set(0.6, 3.2, 0);
      group.add(arm);
      // Backboard
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 1.08, 1.84),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1, opacity: 0.7, transparent: true }),
      );
      board.position.set(1.2, 3.2, 0);
      group.add(board);
      // Orange border on backboard
      const border = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 1.1, 1.86),
        makeMat(0xff6600, 0.5, 0.2),
      );
      border.position.set(1.19, 3.2, 0);
      group.add(border);
      // Inner box on backboard
      const innerBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.45, 0.59),
        makeMat(0xff6600, 0.5, 0.2),
      );
      innerBox.position.set(1.18, 3.15, 0);
      group.add(innerBox);
      // Rim (torus lying horizontally)
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.225, 0.017, 8, 24),
        makeMat(0xff6600, 0.5, 0.3),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.set(1.37, 3.05, 0);
      group.add(rim);
      // Net (simplified as thin cylinder)
      const net = new THREE.Mesh(
        new THREE.CylinderGeometry(0.225, 0.12, 0.45, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, opacity: 0.4, transparent: true, side: THREE.DoubleSide }),
      );
      net.position.set(1.37, 2.82, 0);
      group.add(net);
      // Mirror for right-side hoop (positive x)
      if (x > 0) group.rotation.y = Math.PI;
      group.position.set(x, y, z);
      return group;
    }

    default: {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.8, 0.8),
        makeMat(colorFor("object")),
      );
      mesh.position.set(x, y + 0.4, z);
      mesh.castShadow = true;
      return mesh;
    }
  }
}

function applyUserData(obj: THREE.Object3D, objectId: string, interactable: boolean): void {
  obj.userData = { objectId, interactable };
  obj.traverse((child) => {
    child.userData = { objectId, interactable };
  });
}

function buildObject(obj: SceneObject): THREE.Object3D {
  const { objectId, type, position, interactable } = obj;
  const x = position.x;
  const y = position.y;
  const z = position.z;

  let root: THREE.Object3D;

  switch (type) {
    case "tree": {
      const group = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.4, 2, 8),
        makeMat(0x5c3d1e),
      );
      trunk.position.y = 1;
      trunk.castShadow = true;
      group.add(trunk);

      const foliage = new THREE.Mesh(
        new THREE.ConeGeometry(1.2, 2.5, 8),
        makeMat(colorFor("tree")),
      );
      foliage.position.y = 3.25;
      foliage.castShadow = true;
      group.add(foliage);

      group.position.set(x, y, z);
      root = group;
      break;
    }

    case "building": {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(5, 4, 5),
        makeMat(colorFor("building")),
      );
      body.position.y = 2;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(4, 2, 4),
        makeMat(0x6b3a2a),
      );
      roof.position.y = 5;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      group.add(roof);

      group.position.set(x, y, z);
      root = group;
      break;
    }

    case "npc": {
      // CapsuleGeometry(radius, length, capSegments, radialSegments)
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.4, 0.8, 4, 8),
        makeMat(colorFor("npc")),
      );
      // capsule total height = length + 2*radius = 0.8 + 0.8 = 1.6; center it at y=0.8
      mesh.position.set(x, y + 0.8, z);
      mesh.castShadow = true;
      root = mesh;
      break;
    }

    case "item": {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.5, 1.2, 6),
        makeMat(colorFor("item"), 0.6, 0.3),
      );
      mesh.position.set(x, y + 0.6, z);
      mesh.castShadow = true;
      root = mesh;
      break;
    }

    case "terrain": {
      const shape = obj.metadata.shape as string | undefined;
      if (shape === "wall") {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(8, 3, 0.2),
          makeMat(0xe8e0d0, 0.95, 0),
        );
        mesh.position.set(x, y + 1.5, z);
        mesh.receiveShadow = true;
        root = mesh;
      } else if (shape === "ceiling") {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(20, 0.15, 20),
          makeMat(0xf5f0e8, 1, 0),
        );
        mesh.position.set(x, y + 3.075, z);
        root = mesh;
      } else if (shape === "court") {
        const group = new THREE.Group();
        // Hardwood floor — NBA standard 28m × 15m
        const floor = new THREE.Mesh(
          new THREE.BoxGeometry(28, 0.1, 15),
          makeMat(0xc8822a, 0.85, 0.05),
        );
        floor.position.y = 0.05;
        floor.receiveShadow = true;
        group.add(floor);
        const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
        // Center line
        const centerLine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 15), lineMat);
        centerLine.position.y = 0.11;
        group.add(centerLine);
        // Center circle
        const centerCircle = new THREE.Mesh(
          new THREE.TorusGeometry(1.8, 0.05, 8, 48),
          lineMat,
        );
        centerCircle.rotation.x = Math.PI / 2;
        centerCircle.position.y = 0.11;
        group.add(centerCircle);
        // Key areas (paint) — one each end
        for (const side of [-1, 1]) {
          const paint = new THREE.Mesh(
            new THREE.BoxGeometry(5.8, 0.02, 4.9),
            makeMat(0xb06020, 0.9, 0),
          );
          paint.position.set(side * 11.1, 0.11, 0);
          group.add(paint);
          // Free-throw line
          const ftLine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 4.9), lineMat);
          ftLine.position.set(side * 8.2, 0.115, 0);
          group.add(ftLine);
          // Baseline
          const baseline = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 15), lineMat);
          baseline.position.set(side * 14, 0.115, 0);
          group.add(baseline);
          // Three-point arc (semicircle)
          const arc = new THREE.Mesh(
            new THREE.TorusGeometry(7.24, 0.05, 8, 48, Math.PI),
            lineMat,
          );
          arc.rotation.x = Math.PI / 2;
          arc.rotation.z = side > 0 ? 0 : Math.PI;
          arc.position.set(side * 7.5, 0.115, 0);
          group.add(arc);
        }
        // Sidelines
        for (const side of [-1, 1]) {
          const sideline = new THREE.Mesh(new THREE.BoxGeometry(28, 0.02, 0.05), lineMat);
          sideline.position.set(0, 0.115, side * 7.5);
          group.add(sideline);
        }
        group.position.set(x, y, z);
        root = group;
      } else if (shape === "floor") {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(20, 0.15, 20),
          makeMat(0xc8b89a, 1, 0),
        );
        mesh.position.set(x, y + 0.075, z);
        mesh.receiveShadow = true;
        root = mesh;
      } else {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(8, 0.5, 8),
          makeMat(colorFor("terrain"), 1, 0),
        );
        mesh.position.set(x, y + 0.25, z);
        mesh.receiveShadow = true;
        root = mesh;
      }
      break;
    }

    case "object": {
      root = buildObjectByShape(obj, x, y, z);
      break;
    }

    default: {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 12, 8),
        makeMat(FALLBACK_COLOR),
      );
      mesh.position.set(x, y + 0.8, z);
      mesh.castShadow = true;
      root = mesh;
      break;
    }
  }

  applyUserData(root, objectId, interactable);

  // Random Y rotation for organic look (skip terrain, npcs, and indoor objects)
  if (type !== "terrain" && type !== "npc" && type !== "object") {
    root.rotation.y = Math.random() * Math.PI * 2;
  }
  // Scale jitter ±15% for trees only
  if (type === "tree") {
    const s = 0.85 + Math.random() * 0.3;
    root.scale.set(s, s, s);
  }

  return root;
}

// ── Environment presets ──────────────────────────────────────────────────────

interface EnvPreset {
  skyColor: number;
  groundColor: number;
  fogColor: number;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  ambientIntensity: number;
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

  const tod = timeOfDay ?? skybox; // fall back to skybox key if no separate timeOfDay
  switch (tod) {
    case "dawn":
    case "dusk":
    case "sunset":
      sunColor = 0xff8c42;
      sunIntensity = 0.8;
      sunPosition = [10, 5, 30];
      ambientIntensity = 0.35;
      break;
    case "night":
      sunColor = 0x2244aa;
      sunIntensity = 0.05;
      sunPosition = [0, 20, 0];
      ambientIntensity = 0.15;
      break;
    case "noon":
      sunColor = 0xffffff;
      sunIntensity = 1.4;
      sunPosition = [5, 60, 10];
      ambientIntensity = 0.55;
      break;
    default:
      sunColor = 0xfff4e0;
      sunIntensity = 1.2;
      sunPosition = [30, 50, 20];
      ambientIntensity = 0.5;
      break;
  }

  return { skyColor, groundColor: 0x4a7c59, fogColor: skyColor, sunColor, sunIntensity, sunPosition, ambientIntensity };
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

export class SceneRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private gltfLoader = new GLTFLoader();
  // Group that owns everything added by sceneCode — cleared on every loadScene()
  private codeGroup = new THREE.Group();
  private objects = new Map<string, THREE.Object3D>(); // objectId → root
  private objectMeta = new Map<string, SceneObject>();
  private animFrame = 0;
  private raycaster = new THREE.Raycaster();
  private codeAnimCbs: Array<(delta: number) => void> = [];
  private lastFrameTime = 0;

  // Smooth transition state
  private transitionStart = 0;
  private transitionFrom = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private transitionTo   = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private transitioning  = false;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 40, 120);

    this.camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 500);
    this.camera.position.set(0, 8, 20);
    this.camera.lookAt(0, 0, 0);

    // antialias disabled: EffectComposer uses its own non-MSAA render targets;
    // combining antialias:true with composer causes MSAA framebuffer conflicts.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.6;

    // OrbitControls for free camera exploration
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 200;

    // Lights — will be overridden by loadScene() env settings
    this.hemi = new THREE.HemisphereLight(0x87ceeb, 0x4a7c59, 0.6);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
    this.sun.position.set(30, 50, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -40;
    this.sun.shadow.camera.right = 40;
    this.sun.shadow.camera.top = 40;
    this.sun.shadow.camera.bottom = -40;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 200;
    this.sun.shadow.bias = -0.001;
    this.scene.add(this.sun);

    this.setupGround();
    this.scene.add(this.codeGroup);

    // Post-processing: EffectComposer + bloom + output
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      0.4,   // strength
      0.3,   // radius
      0.85,  // threshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.setupResizeObserver(canvas);
    this.startLoop();
  }

  async loadScene(data: SceneData): Promise<void> {
    // Remove JSON-built objects
    for (const obj of this.objects.values()) {
      this.scene.remove(obj);
    }
    this.objects.clear();
    this.objectMeta.clear();
    this.codeAnimCbs = [];

    // Remove all objects added by previous sceneCode execution
    this.codeGroup.clear();

    // Apply environment settings first (needed for bloom boost logic)
    const env = data.environment ?? {};
    const preset = resolveEnvPreset(env.skybox, env.timeOfDay);

    (this.scene.background as THREE.Color).set(preset.skyColor);
    (this.scene.fog as THREE.Fog).color.set(preset.fogColor);

    this.hemi.color.set(preset.skyColor);
    this.hemi.groundColor.set(preset.groundColor);
    this.hemi.intensity = preset.ambientIntensity;

    this.sun.color.set(preset.sunColor);
    this.sun.intensity = preset.sunIntensity;
    this.sun.position.set(...preset.sunPosition);

    // Apply bloom settings from environment.effects
    const bloomCfg = env.effects?.bloom;
    const baseStrength = bloomCfg?.strength ?? 0.4;
    const isNight = env.skybox === "night" || env.timeOfDay === "night";
    this.bloomPass.strength = isNight ? Math.max(baseStrength, 0.8) : baseStrength;
    this.bloomPass.radius = bloomCfg?.radius ?? 0.3;
    // Clamp threshold to minimum 0.9 — prevents scene-specified low thresholds
    // from blooming ordinary lit surfaces and washing out the image.
    this.bloomPass.threshold = Math.max(bloomCfg?.threshold ?? 0.9, 0.9);

    // Path C: execute sceneCode if present.
    // Mute renderer's built-in lights so sceneCode has full lighting control.
    if (data.sceneCode) {
      this.hemi.intensity = 0;
      this.sun.intensity = 0;
      this.executeCode(data.sceneCode);
      return;
    }

    // Path A + default: restore built-in lights (they were set above from preset)
    // (intensities already applied by preset above — nothing to restore here)
    const loadPromises: Promise<void>[] = [];

    for (const obj of data.objects) {
      const modelUrl = obj.metadata.modelUrl as string | undefined;

      if (modelUrl) {
        // Path A: load GLTF model — show placeholder while loading
        const placeholder = buildObject(obj);
        this.scene.add(placeholder);
        this.objects.set(obj.objectId, placeholder);
        this.objectMeta.set(obj.objectId, obj);

        const promise = this.loadGltfModel(obj, modelUrl, placeholder);
        loadPromises.push(promise);
      } else {
        const node = buildObject(obj);
        this.scene.add(node);
        this.objects.set(obj.objectId, node);
        this.objectMeta.set(obj.objectId, obj);
      }
    }

    // Wait for all GLTF loads (errors are caught inside loadGltfModel)
    await Promise.all(loadPromises);
  }

  private async loadGltfModel(obj: SceneObject, url: string, placeholder: THREE.Object3D): Promise<void> {
    try {
      const gltf = await this.gltfLoader.loadAsync(url);
      const model = gltf.scene;

      // Apply position from SceneObject
      model.position.set(obj.position.x, obj.position.y, obj.position.z);

      // Apply scale from metadata (default 1)
      const scale = (obj.metadata.scale as number | undefined) ?? 1;
      model.scale.setScalar(scale);

      // Apply vertical offset for ground alignment
      const yOffset = (obj.metadata.yOffset as number | undefined) ?? 0;
      model.position.y += yOffset;

      // Enable shadows on all meshes
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      applyUserData(model, obj.objectId, obj.interactable);

      // Replace placeholder with real model
      this.scene.remove(placeholder);
      this.scene.add(model);
      this.objects.set(obj.objectId, model);
    } catch (err) {
      console.warn(`[SceneRenderer] Failed to load GLTF from ${url}:`, err);
      // Keep placeholder — already in scene
    }
  }

  executeCode(code: string): void {
    this.codeAnimCbs = [];

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

    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(
        "THREE", "scene", "camera", "renderer", "controls", "animate",
        code,
      );
      fn(
        THREE,
        sceneProxy,
        this.camera,
        this.renderer,
        this.controls,
        (cb: (delta: number) => void) => { this.codeAnimCbs.push(cb); },
      );
    } catch (err) {
      console.error("[SceneRenderer] sceneCode execution error:", err);
    }
  }

  goToViewpoint(viewpoint: Viewpoint): void {
    this.transitionFrom.pos.copy(this.camera.position);
    this.transitionFrom.target.copy(this.controls.target);

    this.transitionTo.pos.set(viewpoint.position.x, viewpoint.position.y, viewpoint.position.z);
    this.transitionTo.target.set(viewpoint.lookAt.x, viewpoint.lookAt.y, viewpoint.lookAt.z);

    this.transitionStart = performance.now();
    this.transitioning = true;
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
  }

  dispose(): void {
    cancelAnimationFrame(this.animFrame);
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private setupGround(): void {
    const geo = new THREE.PlaneGeometry(200, 200);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a7a3a, roughness: 1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02; // slightly below y=0 to avoid z-fighting with terrain objects
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private setupResizeObserver(canvas: HTMLCanvasElement): void {
    const observer = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.composer.setSize(w, h);
    });
    observer.observe(canvas);
  }

  private startLoop(): void {
    const loop = (now: number) => {
      this.animFrame = requestAnimationFrame(loop);

      const delta = this.lastFrameTime > 0 ? (now - this.lastFrameTime) / 1000 : 0;
      this.lastFrameTime = now;

      // Smooth camera transition
      if (this.transitioning) {
        const elapsed = performance.now() - this.transitionStart;
        const t = Math.min(elapsed / TRANSITION_DURATION, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - t, 3);

        this.camera.position.lerpVectors(this.transitionFrom.pos, this.transitionTo.pos, eased);
        this.controls.target.lerpVectors(this.transitionFrom.target, this.transitionTo.target, eased);

        if (t >= 1) this.transitioning = false;
      }

      // Per-frame callbacks from sceneCode
      for (let i = this.codeAnimCbs.length - 1; i >= 0; i--) {
        try {
          this.codeAnimCbs[i](delta);
        } catch (err) {
          console.warn("[SceneRenderer] codeAnimCb error:", err);
          this.codeAnimCbs.splice(i, 1);
        }
      }

      this.controls.update();
      this.composer.render();
    };
    loop(0);
  }
}
