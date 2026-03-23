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

import * as THREE from "three/webgpu";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";

// Map each skybox preset to a Polyhaven HDRI asset ID.
// 1k resolution: good quality for IBL, small download (~100–300 KB).
const SKYBOX_HDRI_ID: Record<string, string> = {
  clear_day: "kloofendal_48d_partly_cloudy_puresky",
  sunset:    "kloppenheim_06",
  night:     "starlit_golf_course",
  overcast:  "overcast_soil_puresky",
};

const HDR_CDN  = "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k";
const JPEG_CDN = "https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG";

function hdriUrl(id: string): string {
  return `${HDR_CDN}/${id}_2k.hdr`;
}

function jpegUrl(id: string): string {
  return `${JPEG_CDN}/${id}.jpg`;
}

// In-memory cache: skybox preset key → ready PMREM texture
const envCache = new Map<string, THREE.Texture>();
// Track in-flight promises to avoid duplicate requests for the same skybox
const inFlight = new Map<string, Promise<THREE.Texture>>();

// Cache for equirectangular JPEG backgrounds
const bgCache   = new Map<string, THREE.Texture>();
const bgInFlight = new Map<string, Promise<THREE.Texture>>();

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
  renderer: THREE.WebGPURenderer,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const envMap  = (pmrem as any).fromEquirectangular(equirect).texture as THREE.Texture;
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

/**
 * Load (or return cached) equirectangular JPEG texture for use as scene.background.
 * Smaller and faster than the HDR — suitable for visible sky, not for IBL.
 */
export async function loadSkyBackground(skybox: string): Promise<THREE.Texture> {
  if (bgCache.has(skybox)) return bgCache.get(skybox)!;
  if (bgInFlight.has(skybox)) return bgInFlight.get(skybox)!;

  const hdriId = SKYBOX_HDRI_ID[skybox] ?? SKYBOX_HDRI_ID["clear_day"];
  const url = jpegUrl(hdriId);

  const promise = new THREE.TextureLoader()
    .loadAsync(url)
    .then((tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      bgCache.set(skybox, tex);
      bgInFlight.delete(skybox);
      return tex;
    })
    .catch((err) => {
      bgInFlight.delete(skybox);
      throw err;
    });

  bgInFlight.set(skybox, promise);
  return promise;
}
