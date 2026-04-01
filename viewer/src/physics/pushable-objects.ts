import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SceneObject, Viewpoint } from "../types.js";
import { type PlacementHint, resolvePosition } from "./prop-placement.js";

export interface PhysicsProp {
  body: InstanceType<typeof RAPIER.RigidBody>;
  group: THREE.Group;
  objectId: string;
  meshes: THREE.Object3D[];
}

const loader = new GLTFLoader();

export function loadGltf(url: string, timeoutMs = 15000): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`loadGltf timeout: ${url}`)), timeoutMs);
    loader.load(
      url,
      (gltf) => { clearTimeout(timer); resolve(gltf.scene); },
      undefined,
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Build a Rapier collider for the group using the requested shape.
 * Falls back to bounding box when convex hull computation fails.
 */
export function buildCollider(
  world: InstanceType<typeof RAPIER.World>,
  body: InstanceType<typeof RAPIER.RigidBody>,
  group: THREE.Group,
  shape: string,
): void {
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;

  if (shape === "sphere") {
    const r = Math.max(hx, hy, hz);
    world.createCollider(
      RAPIER.ColliderDesc.ball(r).setRestitution(0.3).setFriction(0.8),
      body,
    );
    return;
  }

  if (shape === "convex") {
    const verts: number[] = [];
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const geo = child.geometry;
      const pos = geo.attributes.position;
      const mat = child.matrixWorld.clone();
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat);
        verts.push(v.x, v.y, v.z);
      }
    });
    if (verts.length >= 12) {
      const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(verts));
      if (hull) {
        world.createCollider(hull.setRestitution(0.3).setFriction(0.8), body);
        return;
      }
    }
    // fall through to box
  }

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz).setRestitution(0.3).setFriction(0.8),
    body,
  );
}

// Placeholder geometry shared across all loading props — disposed on module unload.
const PLACEHOLDER_HALF = 0.3;
const placeholderGeo = new THREE.BoxGeometry(
  PLACEHOLDER_HALF * 2,
  PLACEHOLDER_HALF * 2,
  PLACEHOLDER_HALF * 2,
);
// Wireframe-style translucent placeholder so it is visible but clearly temporary.
const placeholderMat = new THREE.MeshStandardMaterial({
  color: 0x6688cc,
  transparent: true,
  opacity: 0.35,
  wireframe: false,
});

/**
 * Register all SceneObjects that are type "prop" and have metadata.modelUrl.
 *
 * Each prop gets a placeholder box immediately so physics is ready without waiting
 * for any network downloads. GLB models are fetched in the background; when each
 * one arrives it replaces the placeholder mesh while keeping the same physics body.
 *
 * Returns the PhysicsProp array synchronously (non-async). The caller must NOT
 * await this — invoke it as a regular function call and the array is populated
 * immediately with placeholder entries that are progressively upgraded.
 *
 * @param disposed - external flag; background loaders check it before swapping
 */
export function loadPhysicsProps(
  world: InstanceType<typeof RAPIER.World>,
  scene: THREE.Scene,
  objects: SceneObject[],
  viewpoints: Viewpoint[],
  disposed: { value: boolean },
  splatGroundOffset?: number,
): PhysicsProp[] {
  const propObjects = objects.filter(
    (o) => o.type === "prop" && typeof o.metadata.modelUrl === "string",
  );

  const result: PhysicsProp[] = [];
  const occupied: Array<{ x: number; y: number; z: number }> = [];

  for (let i = 0; i < propObjects.length; i++) {
    const obj = propObjects[i];
    const modelUrl = obj.metadata.modelUrl as string;
    const physicsShape = (obj.metadata.physicsShape as string | undefined) ?? "box";
    const mass = typeof obj.metadata.mass === "number" ? obj.metadata.mass : 10;
    const scale = typeof obj.metadata.scale === "number" ? obj.metadata.scale : 1;
    const hint = (obj.metadata.placement as PlacementHint | undefined);

    // Resolve position immediately using slot system
    const playerPos = obj.metadata.playerPosition as { x: number; y: number; z: number } | undefined;
    const pos = resolvePosition(hint, world, occupied, viewpoints, i, playerPos, splatGroundOffset);
    occupied.push(pos);

    // ── Placeholder ──────────────────────────────────────────────────────────
    const group = new THREE.Group();
    const placeholderMesh = new THREE.Mesh(placeholderGeo, placeholderMat);
    group.add(placeholderMesh);
    group.position.set(pos.x, pos.y + PLACEHOLDER_HALF, pos.z);
    group.traverse((c) => { c.userData.objectId = obj.objectId; });
    scene.add(group);

    // Physics body centred on the placeholder
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y + PLACEHOLDER_HALF, pos.z)
      .setAdditionalMass(mass);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(PLACEHOLDER_HALF, PLACEHOLDER_HALF, PLACEHOLDER_HALF)
        .setRestitution(0.3)
        .setFriction(0.8),
      body,
    );

    const prop: PhysicsProp = { body, group, objectId: obj.objectId, meshes: [placeholderMesh] };
    result.push(prop);

    // ── Background GLB load ──────────────────────────────────────────────────
    loadGltf(modelUrl).then((loaded) => {
      if (disposed.value) {
        // Physics world already cleaned up — dispose the loaded geometry and bail
        loaded.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            c.geometry.dispose();
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            for (const m of mats) m.dispose();
          }
        });
        return;
      }

      // Scale and position the real model so its bottom sits on the floor
      loaded.scale.setScalar(scale);
      loaded.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(loaded);
      const groundOffset = -bbox.min.y * scale;

      // Replace placeholder content inside the existing group
      group.remove(placeholderMesh);
      // Offset the real model within the group so its floor aligns with the body bottom
      loaded.position.set(0, groundOffset - PLACEHOLDER_HALF, 0);
      loaded.traverse((c) => { c.userData.objectId = obj.objectId; });
      group.add(loaded);

      // Rebuild meshes list for raycasting
      const newMeshes: THREE.Object3D[] = [];
      loaded.traverse((c) => { if (c instanceof THREE.Mesh) newMeshes.push(c); });
      prop.meshes = newMeshes;
    }).catch((err) => {
      console.warn("[loadPhysicsProps] failed to load", modelUrl, err);
      // Placeholder remains visible as a permanent fallback
    });
  }

  return result;
}

export function syncPhysicsProps(props: PhysicsProp[]): void {
  for (const p of props) {
    const t = p.body.translation();
    const r = p.body.rotation();
    p.group.position.set(t.x, t.y, t.z);
    p.group.quaternion.set(r.x, r.y, r.z, r.w);
  }
}

export function disposePhysicsProps(
  props: PhysicsProp[],
  world: InstanceType<typeof RAPIER.World>,
  scene: THREE.Scene,
): void {
  for (const p of props) {
    world.removeRigidBody(p.body);
    scene.remove(p.group);
    p.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) m.dispose();
      }
    });
  }
}
