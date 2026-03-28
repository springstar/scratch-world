import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

const BALL_RADIUS = 0.12;
const SHOOT_SPEED = 20;
const LIFETIME_MS = 8_000;

export interface Projectile {
  body: InstanceType<typeof RAPIER.RigidBody>;
  mesh: THREE.Mesh;
  createdAt: number;
}

const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 10, 10);
const ballMat = new THREE.MeshStandardMaterial({ color: 0xff4400 });

export function shootProjectile(
  world: InstanceType<typeof RAPIER.World>,
  camera: THREE.Camera,
  scene: THREE.Scene,
  projectiles: Projectile[],
): void {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  const spawnPos = camera.position.clone().addScaledVector(dir, 0.5);

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(
    spawnPos.x,
    spawnPos.y,
    spawnPos.z,
  );
  const body = world.createRigidBody(bodyDesc);
  world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS).setRestitution(0.7).setFriction(0.3),
    body,
  );
  body.setLinvel(
    { x: dir.x * SHOOT_SPEED, y: dir.y * SHOOT_SPEED, z: dir.z * SHOOT_SPEED },
    true,
  );

  const mesh = new THREE.Mesh(ballGeo, ballMat);
  mesh.position.copy(spawnPos);
  scene.add(mesh);

  projectiles.push({ body, mesh, createdAt: Date.now() });
}

export function syncProjectiles(projectiles: Projectile[]): void {
  for (const p of projectiles) {
    const t = p.body.translation();
    p.mesh.position.set(t.x, t.y, t.z);
    const r = p.body.rotation();
    p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}

export function cleanupOldProjectiles(
  world: InstanceType<typeof RAPIER.World>,
  projectiles: Projectile[],
  scene: THREE.Scene,
): void {
  const now = Date.now();
  let i = projectiles.length;
  while (i-- > 0) {
    if (now - projectiles[i].createdAt > LIFETIME_MS) {
      const p = projectiles[i];
      world.removeRigidBody(p.body);
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}
