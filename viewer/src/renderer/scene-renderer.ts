import * as THREE from "three";
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

function buildObject(obj: SceneObject): THREE.Mesh {
  const isLarge = obj.type === "building" || obj.type === "terrain";
  const geometry = isLarge
    ? new THREE.BoxGeometry(4, 4, 4)
    : new THREE.BoxGeometry(1.5, 1.5, 1.5);

  const material = new THREE.MeshStandardMaterial({
    color: colorFor(obj.type),
    roughness: 0.8,
    metalness: 0.1,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(obj.position.x, obj.position.y + (isLarge ? 2 : 0.75), obj.position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { objectId: obj.objectId, interactable: obj.interactable };
  return mesh;
}

export interface PickResult {
  objectId: string;
  name: string;
  interactable: boolean;
  interactionHint?: string;
}

export class SceneRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private meshes = new Map<string, THREE.Mesh>(); // objectId → mesh
  private objectMeta = new Map<string, SceneObject>();
  private animFrame = 0;
  private raycaster = new THREE.Raycaster();

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 40, 120);

    this.camera = new THREE.PerspectiveCamera(
      60,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      500,
    );
    this.camera.position.set(0, 8, 20);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled = true;

    this.setupLights();
    this.setupGround();
    this.setupResizeObserver(canvas);
    this.startLoop();
  }

  loadScene(data: SceneData): void {
    // Remove existing object meshes
    for (const mesh of this.meshes.values()) {
      this.scene.remove(mesh);
    }
    this.meshes.clear();
    this.objectMeta.clear();

    for (const obj of data.objects) {
      const mesh = buildObject(obj);
      this.scene.add(mesh);
      this.meshes.set(obj.objectId, mesh);
      this.objectMeta.set(obj.objectId, obj);
    }
  }

  goToViewpoint(viewpoint: Viewpoint): void {
    this.camera.position.set(
      viewpoint.position.x,
      viewpoint.position.y,
      viewpoint.position.z,
    );
    this.camera.lookAt(
      viewpoint.lookAt.x,
      viewpoint.lookAt.y,
      viewpoint.lookAt.z,
    );
  }

  // Returns the first interactable object under the pointer, or null
  pick(ndcX: number, ndcY: number): PickResult | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const meshList = [...this.meshes.values()];
    const hits = this.raycaster.intersectObjects(meshList);
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
    for (const [id, mesh] of this.meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.emissive.set(id === objectId && objectId !== null ? 0x444400 : 0x000000);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.animFrame);
    this.renderer.dispose();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun);
  }

  private setupGround(): void {
    const geo = new THREE.PlaneGeometry(200, 200);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a7a3a, roughness: 1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
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
    });
    observer.observe(canvas);
  }

  private startLoop(): void {
    const loop = () => {
      this.animFrame = requestAnimationFrame(loop);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
}
