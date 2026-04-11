import RAPIER from "@dimforge/rapier3d-compat";

// Capsule: half-height 0.6 + radius 0.3 on each end → ~1.8m tall.
// After the COLMAP→Three.js PI flip, the floor sits at Y = -splatGroundOffset.
// onLockChange in SplatViewer overrides the SPAWN Y immediately on pointer lock,
// deriving body centre from camera.y - 0.8 (camera already positioned above the actual floor).
// SPAWN is only used for the initial Rapier body before pointer lock is acquired.
const HALF_HEIGHT = 0.6;
const RADIUS = 0.3;
const SPAWN = { x: 0, y: 0.9, z: 0 }; // temporary; overridden by onLockChange

export interface CharacterController {
  body: InstanceType<typeof RAPIER.RigidBody>;
  collider: InstanceType<typeof RAPIER.Collider>;
  controller: InstanceType<typeof RAPIER.KinematicCharacterController>;
  verticalVel: number;
  move(
    world: InstanceType<typeof RAPIER.World>,
    desiredHorizontal: { x: number; z: number },
    delta: number,
  ): void;
}

export function createCharacterController(
  world: InstanceType<typeof RAPIER.World>,
): CharacterController {
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    SPAWN.x,
    SPAWN.y,
    SPAWN.z,
  );
  const body = world.createRigidBody(bodyDesc);
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), body);

  const controller = world.createCharacterController(0.01);
  controller.setUp({ x: 0, y: 1, z: 0 }); // standard Y-up after PI-flip baked into collider
  controller.setMaxSlopeClimbAngle(Math.PI / 4);
  controller.setMinSlopeSlideAngle(Math.PI / 6);
  controller.enableAutostep(0.5, 0.2, true);
  controller.enableSnapToGround(0.5);
  controller.setApplyImpulsesToDynamicBodies(true);

  const cc: CharacterController = {
    body,
    collider,
    controller,
    verticalVel: 0,
    move(
      _world: InstanceType<typeof RAPIER.World>,
      desiredHorizontal: { x: number; z: number },
      delta: number,
    ) {
      if (this.controller.computedGrounded()) {
        this.verticalVel = 0;
      } else {
        this.verticalVel -= 9.81 * delta; // fall toward -Y (standard gravity)
      }

      const desired = {
        x: desiredHorizontal.x,
        y: this.verticalVel * delta,
        z: desiredHorizontal.z,
      };

      this.controller.computeColliderMovement(this.collider, desired);
      const corrected = this.controller.computedMovement();
      const pos = this.body.translation();
      this.body.setNextKinematicTranslation({
        x: pos.x + corrected.x,
        y: pos.y + corrected.y,
        z: pos.z + corrected.z,
      });
    },
  };

  return cc;
}
