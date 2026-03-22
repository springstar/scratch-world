/**
 * texture-cache.ts
 *
 * Lazy, per-session cache for Polyhaven PBR textures (1k JPG, CC0).
 *
 * Usage:
 *   applyTerrainPbr(mat, "aerial_grass_rock_02", 4, () => invalidate(2))
 *
 * Polyhaven CDN pattern:
 *   https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{id}/{id}_{map}_1k.jpg
 *
 * Maps loaded per terrain shape:
 *   nor_gl  — OpenGL-convention normal map (compatible with Three.js)
 *   rough   — roughness map (R channel used by roughnessMap)
 *
 * Strategy: fire-and-forget.  Slope-blend color material renders immediately;
 * normal + roughness maps are applied once downloaded (~50–150 KB each).
 */

import * as THREE from "three";

const CDN = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k";

function texUrl(id: string, map: string): string {
  return `${CDN}/${id}/${id}_${map}_1k.jpg`;
}

const texCache  = new Map<string, THREE.Texture>();
const inFlight  = new Map<string, Promise<THREE.Texture>>();
const texLoader = new THREE.TextureLoader();

function loadTex(id: string, map: string): Promise<THREE.Texture> {
  const key = `${id}__${map}`;
  if (texCache.has(key))  return Promise.resolve(texCache.get(key)!);
  if (inFlight.has(key))  return inFlight.get(key)!;

  const p = texLoader
    .loadAsync(texUrl(id, map))
    .then((tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      texCache.set(key, tex);
      inFlight.delete(key);
      return tex;
    })
    .catch((err) => {
      inFlight.delete(key);
      throw err;
    });

  inFlight.set(key, p);
  return p;
}

/**
 * Async-upgrade a MeshStandardMaterial with Polyhaven normal + roughness maps.
 *
 * @param mat        - The material to upgrade in-place
 * @param textureId  - Polyhaven asset ID (e.g. "aerial_grass_rock_02")
 * @param repeat     - UV tiling (applied to both maps)
 * @param onUpdate   - Called after maps are applied; use to queue a render frame
 */
export function applyTerrainPbr(
  mat: THREE.MeshStandardMaterial,
  textureId: string,
  repeat: number,
  onUpdate: () => void,
): void {
  Promise.all([
    loadTex(textureId, "nor_gl"),
    loadTex(textureId, "rough").catch(() => null), // rough is optional — not all assets have it
  ])
    .then(([nor, rough]) => {
      nor.repeat.set(repeat, repeat);
      mat.normalMap = nor;
      mat.normalScale.set(0.7, 0.7); // moderate strength — doesn't override slope-blend color
      if (rough !== null) {
        rough.repeat.set(repeat, repeat);
        mat.roughnessMap = rough;
      }
      mat.needsUpdate = true;
      onUpdate();
    })
    .catch(() => {
      // Network failure — slope-blend color material stays unchanged
    });
}
