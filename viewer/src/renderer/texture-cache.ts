/**
 * texture-cache.ts
 *
 * Lazy, per-session cache for Polyhaven PBR textures (2k JPG, CC0).
 *
 * Maps loaded per material (each independently — one failure doesn't block others):
 *   diff    — diffuse / albedo color map
 *   nor_gl  — OpenGL normal map
 *   rough   — roughness map
 *   ao      — ambient occlusion (requires UV2 on geometry — call setupUv2() first)
 *   disp    — displacement / height map (requires subdivided geometry)
 *
 * Polyhaven CDN: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/{id}/{id}_{map}_2k.jpg
 */

import * as THREE from "three/webgpu";
import { texture, color, mix, normalMap, normalLocal, vec2 } from "three/tsl";

const CDN = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k";

/**
 * Normalize legacy / shorthand texture IDs to the actual Polyhaven asset ID.
 * Agent-generated scenes may use abbreviated names; this map resolves them.
 */
const TEXTURE_ALIASES: Record<string, string> = {
  marble:          "marble_01",
  cobblestone:     "cobblestone_floor_01",
  cobblestone_01:  "cobblestone_floor_01",
  red_brick:       "red_brick_03",
  wood_floor_02:   "wood_floor",
  aerial_grass:    "aerial_grass_rock",
};

function resolveId(id: string): string {
  return TEXTURE_ALIASES[id] ?? id;
}

function texUrl(id: string, map: string): string {
  return `${CDN}/${id}/${id}_${map}_2k.jpg`;
}

const texCache  = new Map<string, THREE.Texture>();
const inFlight  = new Map<string, Promise<THREE.Texture>>();
const texLoader = new THREE.TextureLoader();

function loadTex(id: string, map: string): Promise<THREE.Texture> {
  const resolved = resolveId(id);
  const key = `${resolved}__${map}`;
  if (texCache.has(key))  return Promise.resolve(texCache.get(key)!);
  if (inFlight.has(key))  return inFlight.get(key)!;

  const p = texLoader
    .loadAsync(texUrl(resolved, map))
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

/**
 * Async-upgrade a MeshStandardNodeMaterial (TSL slope-blended terrain) with
 * Polyhaven PBR maps via TSL nodes.
 *
 * Because the material uses a custom colorNode, the legacy mat.map property is
 * ignored by the WebGPU renderer. This function wires each map in as a proper
 * TSL node so all channels take effect:
 *   colorNode  — diffuse albedo tinted by slope blend (top vs side colour)
 *   normalNode — Polyhaven normal map
 *   roughnessNode — roughness channel (red channel of roughness map)
 *   aoNode     — ambient occlusion channel (red channel of AO map)
 *
 * @param mat        MeshStandardNodeMaterial to upgrade
 * @param textureId  Polyhaven asset ID (e.g. "aerial_grass_rock")
 * @param repeat     UV tiling applied to all maps
 * @param topColor   Hex colour tint for flat (top) faces
 * @param sideColor  Hex colour tint for steep (side) faces
 * @param lo         smoothstep low edge for slope blend (normalLocal.y)
 * @param hi         smoothstep high edge for slope blend
 * @param onUpdate   Called after each map applies — use to queue a render frame
 */
export function applyTerrainPbrNode(
  mat: THREE.MeshStandardNodeMaterial,
  textureId: string,
  repeat: number,
  topColor: number,
  sideColor: number,
  lo: number,
  hi: number,
  onUpdate: () => void,
): void {
  const blend = normalLocal.y.smoothstep(lo, hi);

  // Diffuse — albedo texture tinted by slope colours (mul×2 normalises dark hex tones)
  loadTex(textureId, "diff")
    .then((diff) => {
      diff.repeat.set(repeat, repeat);
      const albedo    = texture(diff);
      const slopeTint = mix(color(sideColor), color(topColor), blend);
      mat.colorNode   = albedo.mul(slopeTint).mul(1.4);
      mat.needsUpdate = true;
      onUpdate();
    })
    .catch(() => {});

  // Normal map
  loadTex(textureId, "nor_gl")
    .then((nor) => {
      nor.repeat.set(repeat, repeat);
      mat.normalNode  = normalMap(texture(nor), vec2(0.85, 0.85));
      mat.needsUpdate = true;
      onUpdate();
    })
    .catch(() => {});

  // Roughness — sample red channel
  loadTex(textureId, "rough")
    .then((rough) => {
      rough.repeat.set(repeat, repeat);
      mat.roughnessNode = texture(rough).r;
      mat.needsUpdate   = true;
      onUpdate();
    })
    .catch(() => {});

  // Ambient occlusion — sample red channel
  loadTex(textureId, "ao")
    .then((ao) => {
      ao.repeat.set(repeat, repeat);
      mat.aoNode      = texture(ao).r;
      mat.needsUpdate = true;
      onUpdate();
    })
    .catch(() => {});
}
