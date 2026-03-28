import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Load the collider GLB from Marble's CDN, apply the COLMAP→Three.js coordinate
 * flip (rotation.x = PI), bake the world transform into each mesh's geometry,
 * then register fixed trimesh colliders in the Rapier world.
 *
 * The collider mesh is never added to the Three.js scene — it is invisible.
 */
export function buildWorldColliders(
  world: InstanceType<typeof RAPIER.World>,
  colliderMeshUrl: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      colliderMeshUrl,
      (gltf) => {
        // Apply the same COLMAP→Three.js flip that SplatMesh uses
        gltf.scene.rotation.x = Math.PI;
        gltf.scene.updateWorldMatrix(true, true);

        gltf.scene.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const geo = child.geometry.clone();
          // Bake accumulated world transform (incl. the PI flip) into vertex positions
          geo.applyMatrix4(child.matrixWorld);

          if (!geo.index) {
            console.warn("[buildWorldColliders] skipping non-indexed mesh", child.name);
            geo.dispose();
            return;
          }

          const vertices = new Float32Array(geo.attributes.position.array);
          const indices = new Uint32Array(geo.index.array);
          const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
          world.createCollider(
            RAPIER.ColliderDesc.trimesh(vertices, indices)
              .setRestitution(0.3)
              .setFriction(0.8),
            body,
          );
          geo.dispose();
        });

        console.log("[buildWorldColliders] collider mesh loaded");
        resolve();
      },
      undefined,
      (err) => reject(new Error(`Failed to load collider mesh: ${String(err)}`)),
    );
  });
}
