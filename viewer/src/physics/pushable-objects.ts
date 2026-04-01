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

export function loadGltf(url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
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
    // Extract all mesh vertices in group-local space
    const verts: number[] = [];
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const geo = child.geometry;
      const pos = geo.attributes.position;
      const mat = child.matrixWorld.clone();
      // Make coordinates relative to the group's world origin (group is at origin at this point)
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

  // Default: axis-aligned bounding box
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz).setRestitution(0.3).setFriction(0.8),
    body,
  );
}

/**
 * Load all SceneObjects that are type "prop" and have metadata.modelUrl.
 * Positions are resolved via the A+C placement system (slot arc + semantic hint + Rapier floor cast).
 */
export async function loadPhysicsProps(
  world: InstanceType<typeof RAPIER.World>,
  scene: THREE.Scene,
  objects: SceneObject[],
  viewpoints: Viewpoint[],
): Promise<PhysicsProp[]> {
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

    let group: THREE.Group;
    try {
      group = await loadGltf(modelUrl);
    } catch (err) {
      console.warn("[loadPhysicsProps] failed to load", modelUrl, err);
      continue;
    }

    group.scale.setScalar(scale);
    group.updateMatrixWorld(true);

    // Tag all meshes for raycasting pick
    group.traverse((child) => {
      child.userData.objectId = obj.objectId;
    });

    // Resolve world position (slot system + floor detection)
    const pos = resolvePosition(hint, world, occupied, viewpoints, i);
    occupied.push(pos);

    // Offset Y so the bounding box bottom sits on the floor
    const bbox = new THREE.Box3().setFromObject(group);
    const groundOffset = -bbox.min.y * scale;
    group.position.set(pos.x, pos.y + groundOffset, pos.z);
    scene.add(group);

    // Create Rapier dynamic body at the bounding box centre
    const bboxWorld = new THREE.Box3().setFromObject(group);
    const centre = new THREE.Vector3();
    bboxWorld.getCenter(centre);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(centre.x, centre.y, centre.z)
      .setAdditionalMass(mass);
    const body = world.createRigidBody(bodyDesc);
    buildCollider(world, body, group, physicsShape);

    // Collect leaf meshes for raycasting
    const meshes: THREE.Object3D[] = [];
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });

    result.push({ body, group, objectId: obj.objectId, meshes });
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
