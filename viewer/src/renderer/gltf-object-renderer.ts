import * as THREE from "three";
import { loadGltf, resolveModelUrl } from "../physics/pushable-objects.js";
import type { SceneObject } from "../types.js";
import type { ObjectRenderer, RenderOptions } from "./object-renderer.js";

/**
 * Renders any SceneObject that has metadata.modelUrl by loading a GLTF/GLB file.
 *
 * Responsibilities:
 *   - Resolve Polyhaven proxy rewrites via resolveModelUrl
 *   - Load via shared GLTFLoader (cached by pushable-objects)
 *   - Apply IBL env map to MeshStandardMaterial faces when opts.envMap is provided
 *
 * Scale is NOT applied here — callers continue to read obj.metadata.scale and apply
 * it themselves so that bounding-box / ground-offset calculations remain unchanged.
 */
export class GltfObjectRenderer implements ObjectRenderer {
  readonly type = "gltf";

  canRender(obj: SceneObject): boolean {
    return typeof obj.metadata.modelUrl === "string" && (obj.metadata.modelUrl as string).length > 0;
  }

  async render(obj: SceneObject, opts?: RenderOptions): Promise<THREE.Object3D> {
    const modelUrl = obj.metadata.modelUrl as string;
    const group = await loadGltf(resolveModelUrl(modelUrl));

    if (opts?.envMap) {
      const envMap = opts.envMap;
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.envMap = envMap;
            mat.envMapIntensity = 0.6;
            mat.needsUpdate = true;
          }
        }
      });
    }

    return group;
  }

  dispose(mesh: THREE.Object3D): void {
    mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) (m as THREE.Material).dispose();
    });
  }
}
