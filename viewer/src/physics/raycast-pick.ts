import * as THREE from "three";

/**
 * Cast a ray from the camera centre forward and return the objectId of the
 * first prop mesh found within maxDistance.
 *
 * Prop meshes must have mesh.userData.objectId set.
 */
export function pickObject(
  camera: THREE.Camera,
  propMeshes: THREE.Object3D[],
  maxDistance: number,
): string | null {
  if (propMeshes.length === 0) return null;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = maxDistance;

  const hits = raycaster.intersectObjects(propMeshes, true);
  if (hits.length === 0) return null;

  // Walk up the hierarchy to find the objectId tag
  let obj: THREE.Object3D | null = hits[0].object;
  while (obj) {
    const id = obj.userData.objectId as string | undefined;
    if (id) return id;
    obj = obj.parent;
  }
  return null;
}
