/**
 * texture-cache.ts
 *
 * Lazy, per-session cache for Polyhaven PBR textures (1k JPG, CC0).
 *
 * Maps loaded per material (each independently — one failure doesn't block others):
 *   diff    — diffuse / albedo color map
 *   nor_gl  — OpenGL normal map
 *   rough   — roughness map
 *   ao      — ambient occlusion (requires UV2 on geometry — call setupUv2() first)
 *   disp    — displacement / height map (requires subdivided geometry)
 *
 * Polyhaven CDN: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{id}/{id}_{map}_1k.jpg
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
 * Copy the primary UV channel to uv1/uv2 so Three.js aoMap and lightMap work.
 * Call this immediately after creating a geometry, before mesh construction.
 */
export function setupUv2(geo: THREE.BufferGeometry): void {
  const uv = geo.attributes.uv;
  if (!uv) return;
  // Set both uv1 (Three.js r152+) and uv2 (legacy) for broad compatibility
  if (!geo.attributes.uv1) geo.setAttribute("uv1", uv.clone());
  if (!geo.attributes.uv2) geo.setAttribute("uv2", uv.clone());
}

/**
 * Async-upgrade a MeshStandardMaterial with Polyhaven PBR maps.
 * Each map loads independently.
 *
 * @param mat               Material to upgrade in-place
 * @param textureId         Polyhaven asset ID (e.g. "aerial_grass_rock_02")
 * @param repeat            UV tiling applied to all maps
 * @param onUpdate          Called after each map applies — use to queue a render frame
 * @param displacementScale Optional displacement height (world units). Only effective
 *                          if the geometry has enough vertex subdivisions (≥16×16).
 *                          Default 0 = no displacement.
 */
export function applyTerrainPbr(
  mat: THREE.MeshStandardMaterial,
  textureId: string,
  repeat: number,
  onUpdate: () => void,
  displacementScale = 0,
): void {
  // Diffuse / albedo
  loadTex(textureId, "diff")
    .then((diff) => {
      diff.repeat.set(repeat, repeat);
      mat.map = diff;
      mat.needsUpdate = true;
      onUpdate();
    })
    .catch(() => {});

  // Normal map
  loadTex(textureId, "nor_gl")
    .then((nor) => {
      nor.repeat.set(repeat, repeat);
      mat.normalMap = nor;
      mat.normalScale.set(0.85, 0.85);
      mat.needsUpdate = true;
      onUpdate();
    })
    .catch(() => {});

  // Roughness map
  loadTex(textureId, "rough")
    .then((rough) => {
      rough.repeat.set(repeat, repeat);
      mat.roughnessMap = rough;
      mat.needsUpdate = true;
      onUpdate();
    })
    .catch(() => {});

  // Ambient occlusion — adds contact shadows in crevices
  // Requires geometry to have uv1/uv2 attribute (call setupUv2 beforehand)
  loadTex(textureId, "ao")
    .then((ao) => {
      ao.repeat.set(repeat, repeat);
      mat.aoMap = ao;
      mat.aoMapIntensity = 1.2;
      mat.needsUpdate = true;
      onUpdate();
    })
    .catch(() => {});

  // Displacement map — real geometric surface detail
  // Only meaningful with subdivided geometry; scale=0 skips it
  if (displacementScale > 0) {
    loadTex(textureId, "disp")
      .then((disp) => {
        disp.repeat.set(repeat, repeat);
        mat.displacementMap = disp;
        mat.displacementScale = displacementScale;
        mat.displacementBias  = -displacementScale * 0.5; // centre around original surface
        mat.needsUpdate = true;
        onUpdate();
      })
      .catch(() => {});
  }
}
