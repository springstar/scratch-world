import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

const BOX_HALF = 0.4; // 0.8m cube
const MASS = 5;

const SPAWN_POSITIONS = [
  { x: 2, y: 0.5, z: 3 },
  { x: -2, y: 0.5, z: 4 },
  { x: 0, y: 0.5, z: 5 },
];

export interface PushableObject {
  body: InstanceType<typeof RAPIER.RigidBody>;
  mesh: THREE.Mesh;
}

const boxGeo = new THREE.BoxGeometry(BOX_HALF * 2, BOX_HALF * 2, BOX_HALF * 2);
const boxMat = new THREE.MeshStandardMaterial({ color: 0x4488cc });

export function addPushableBoxes(
  world: InstanceType<typeof RAPIER.World>,
  scene: THREE.Scene,
): PushableObject[] {
  return SPAWN_POSITIONS.map((pos) => {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setAdditionalMass(MASS);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(BOX_HALF, BOX_HALF, BOX_HALF)
        .setRestitution(0.3)
        .setFriction(0.8),
      body,
    );

    const mesh = new THREE.Mesh(boxGeo, boxMat);
    mesh.position.set(pos.x, pos.y, pos.z);
    scene.add(mesh);

    return { body, mesh };
  });
}

export function syncPushableObjects(objects: PushableObject[]): void {
  for (const o of objects) {
    const t = o.body.translation();
    o.mesh.position.set(t.x, t.y, t.z);
    const r = o.body.rotation();
    o.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}
