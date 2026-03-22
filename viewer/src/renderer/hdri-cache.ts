/**
 * hdri-cache.ts
 *
 * Lazy, per-session cache for Polyhaven HDRI environment maps.
 *
 * - Downloads 1k .hdr from Polyhaven CDN on first use (~100–300 KB each)
 * - Converts to PMREM texture via PMREMGenerator once
 * - Caches the resulting THREE.Texture in memory for the session lifetime
 * - Subsequent loadScene() calls with the same skybox reuse the cached texture
 *
 * Polyhaven CDN pattern (1k .hdr):
 *   https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/{id}_1k.hdr
 *
 * All assets are CC0 licensed — no attribution required.
 */

import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";

// Map each skybox preset to a Polyhaven HDRI asset ID.
// 1k resolution: good quality for IBL, small download (~100–300 KB).
const SKYBOX_HDRI_ID: Record<string, string> = {
  clear_day: "kloofendal_48d_partly_cloudy_puresky",
  sunset:    "kloppenheim_06",
  night:     "starlit_golf_course",
  overcast:  "overcast_soil_puresky",
};

const CDN = "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k";

function hdriUrl(id: string): string {
  return `${CDN}/${id}_2k.hdr`;
}

// In-memory cache: skybox preset key → ready PMREM texture
const envCache = new Map<string, THREE.Texture>();
// Track in-flight promises to avoid duplicate requests for the same skybox
const inFlight = new Map<string, Promise<THREE.Texture>>();

const rgbeLoader = new RGBELoader();

/**
 * Load (or return cached) PMREM environment texture for a skybox preset.
 *
 * @param skybox  - One of the skybox preset strings ("clear_day", "sunset", etc.)
 * @param renderer - WebGLRenderer needed by PMREMGenerator
 * @returns        Promise<THREE.Texture> — ready to assign to scene.environment
 */
export async function loadEnvMap(
  skybox: string,
  renderer: THREE.WebGLRenderer,
): Promise<THREE.Texture> {
  const key = skybox;

  if (envCache.has(key)) return envCache.get(key)!;
  if (inFlight.has(key))  return inFlight.get(key)!;

  const hdriId = SKYBOX_HDRI_ID[key] ?? SKYBOX_HDRI_ID["clear_day"];
  const url    = hdriUrl(hdriId);

  const promise = rgbeLoader
    .loadAsync(url)
    .then((equirect) => {
      equirect.mapping = THREE.EquirectangularReflectionMapping;

      const pmrem   = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      const envMap  = pmrem.fromEquirectangular(equirect).texture;
      pmrem.dispose();
      equirect.dispose();

      envCache.set(key, envMap);
      inFlight.delete(key);
      return envMap;
    })
    .catch((err) => {
      // Network failure — remove from inFlight so a retry is possible next time
      inFlight.delete(key);
      throw err;
    });

  inFlight.set(key, promise);
  return promise;
}
