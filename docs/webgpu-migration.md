# WebGPU + TSL Migration

Migrated the scratch-world viewer from `THREE.WebGLRenderer` + GLSL to `THREE.WebGPURenderer` + TSL (Three.js Shading Language). Three.js 0.175 was already installed — no version bump needed.

---

## What Changed

### Renderer

| Before | After |
|---|---|
| `THREE.WebGLRenderer` | `THREE.WebGPURenderer` |
| `EffectComposer` + 4–7 passes | `THREE.PostProcessing` + TSL node graph |
| `UnrealBloomPass`, `SSAOPass`, `BokehPass`, `SMAAPass` | `bloom()`, `smaa()` from `three/addons/tsl/display/` |
| `Sky` (ShaderMaterial uniforms) | `SkyMesh` (direct `.turbidity.value` access) |
| `Water` + `Reflector` + GLSL | `WaterMesh` (TSL built-in, auto-animates) |
| `onBeforeCompile` GLSL injection | `MeshStandardNodeMaterial` + TSL `normalLocal.y.smoothstep()` |
| `requestAnimationFrame` + sync `render()` | `renderer.setAnimationLoop(async)` + `renderAsync()` |

### Materials

`makeTerrainSlopeMat()` replaced GLSL shader injection with a pure TSL node graph:

```typescript
// Before — WebGL only
const mat = new THREE.MeshStandardMaterial();
mat.onBeforeCompile = (shader) => { /* GLSL string injection */ };

// After — WebGPU native
import { color, normalLocal, mix } from "three/tsl";
const mat = new THREE.MeshStandardNodeMaterial({ roughness, metalness: 0 });
mat.colorNode = mix(color(sideColor), color(topColor), normalLocal.y.smoothstep(lo, hi));
```

### sceneCode Sandbox

The `executeCode()` sandbox now exposes `tsl` (all TSL exports) and `WaterMesh`:

```javascript
// Available in sceneCode:
const { time, oscSine, color, uniform } = tsl;
const mat = new THREE.MeshStandardNodeMaterial();
mat.emissiveNode = color(0xff00ff).mul(oscSine(time.mul(2.0)));
```

---

## Files Changed

| File | Change |
|---|---|
| `viewer/src/renderer/scene-renderer.ts` | Major — renderer swap, PostProcessing, TSL materials, SkyMesh, WaterMesh, sceneCode sandbox |
| `viewer/src/renderer/hdri-cache.ts` | Import `three/webgpu`; renderer type `WebGPURenderer`; fix JPEG background URL |
| `viewer/src/renderer/texture-cache.ts` | Import `three/webgpu`; add `TEXTURE_ALIASES` normalization map |
| `viewer/src/components/ViewerCanvas.tsx` | WebGPU browser gate (`navigator.gpu`); async `await r.init()` |
| `src/skills/skill-loader.ts` | Register new `webgpu-threejs-tsl` skill |
| `src/skills/built-in/webgpu-threejs-tsl/SKILL.md` | **New** — TSL node reference, NodeMaterial examples, GPU compute |
| `src/skills/built-in/threejs-shaders/SKILL.md` | Prepend WebGPU migration note |
| `src/skills/built-in/threejs-postprocessing/SKILL.md` | Replace EffectComposer docs with TSL PostProcessing patterns |
| `src/skills/built-in/threejs-materials/SKILL.md` | Add `MeshStandardNodeMaterial` section |
| `src/skills/built-in/renderer-threejs/SKILL.md` | Note WebGPURenderer + `tsl`/`WaterMesh` in sandbox |

---

## Bug Log

### Bug 1 — Black screen (race condition)

**Symptom:** Scene loads ("Loading World" flashes) then goes black immediately.

**Root cause:** `loadScene()` was called before `init()` completed. The `initPromise` field wasn't set, so the guard `if (this.initPromise) await this.initPromise` silently skipped the wait.

**Fix:** `init()` sets `this.initPromise` synchronously at the top of the method (before any `await`), so any subsequent `loadScene()` call correctly awaits it.

```typescript
async init(): Promise<void> {
  this.initPromise = (async () => {   // ← set synchronously, before any await
    await this.renderer.init();
    // ...
  })();
  return this.initPromise;
}
```

---

### Bug 2 — Black screen (synchronous render in async WebGPU backend)

**Symptom:** Scene still black after race condition fix.

**Root cause:** The render loop used `requestAnimationFrame` + synchronous `postProcessing.render()`. The WebGPU backend is async — GPU commands are queued asynchronously, and the synchronous call didn't flush them correctly. No error was thrown; frames simply produced no visible output.

**Fix:** Switched to `renderer.setAnimationLoop(async () => {...})` + `await postProcessing.renderAsync()`. This is the correct pattern for Three.js WebGPU.

```typescript
// Before — wrong for WebGPU
const loop = (now: number) => {
  requestAnimationFrame(loop);
  this.postProcessing.render();  // sync call, silently no-ops in WebGPU
};

// After — correct
this.renderer.setAnimationLoop(async (now: number) => {
  // ...
  await this.postProcessing.renderAsync();
});
```

`dispose()` updated to call `renderer.setAnimationLoop(null)` instead of `cancelAnimationFrame`.

---

### Bug 3 — Black screen (zero-size WebGPU textures)

**Symptom:** WebGPU console warning: `The texture size ([Extent3D width:0, height:0]) is empty`.

**Root cause:** The `THREE.WebGPURenderer` constructor was called with `canvas.clientWidth / canvas.clientHeight` before CSS layout ran — the canvas had 0×0 dimensions. WebGPU rejected texture creation, corrupting the PostProcessing pipeline.

**Fix:**
1. Constructor uses `Math.max(1, canvas.clientWidth)` as a safety floor.
2. `init()` re-applies the real dimensions *after* `await renderer.init()` — by that point the browser has completed CSS layout.

```typescript
constructor(canvas: HTMLCanvasElement) {
  // Guard: canvas may have 0×0 before CSS layout
  this.renderer.setSize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
}

async init(): Promise<void> {
  this.initPromise = (async () => {
    await this.renderer.init();
    if (this.disposed) return;
    // CSS layout is complete after the above await — set real size
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h);
    // ...
  })();
}
```

---

### Bug 4 — Crash on React Strict Mode double-mount

**Symptom:** `Uncaught TypeError: Cannot read properties of null (reading 'dispose')` — appeared twice (Strict Mode double-invoke). React reported an error in `<ViewerCanvas>`.

**Root cause:** React Strict Mode runs effect cleanup immediately after mount to detect side effects. The cleanup called `dispose()` while `await renderer.init()` was still pending. The WebGPU backend's internal resources were null at that point, so `renderer.dispose()` threw.

**Fix:** Added a `disposed` flag:
- `dispose()` checks `if (this.disposed) return` — prevents double-dispose.
- `init()` checks `if (this.disposed) return` after `await renderer.init()` — aborts silently if cleanup ran during the async wait.
- Both `renderer.setAnimationLoop(null)` and `renderer.dispose()` wrapped in `try/catch` for the uninitialized case.

```typescript
private disposed = false;

dispose(): void {
  if (this.disposed) return;
  this.disposed = true;
  try { this.renderer.setAnimationLoop(null); } catch (_) {}
  this.controls.dispose();
  try { this.renderer.dispose(); } catch (_) {}
}

async init(): Promise<void> {
  this.initPromise = (async () => {
    await this.renderer.init();
    if (this.disposed) return;  // ← bail if cleanup ran
    // ...
  })();
}
```

---

### Bug 5 — Black screen (broken bloom shader graph)

**Symptom:** Scene still black after all the above fixes. No `[SceneRenderer] render error:` in console. Stripping PostProcessing to a bare pass-through (no effects) immediately fixed the black screen.

**Root cause:** `BloomNode` internally wraps its constructor arguments in `uniform()`. The code was passing `uniform(0.4)` as the strength argument, creating `uniform(uniform(0.4))` — a doubly-wrapped shader node that produced a broken WGSL shader graph and silently rendered nothing.

```typescript
// Before — WRONG: bloom() already calls uniform() internally
this.bloomStrength = uniform(0.4);
const bloomNode = bloom(sceneColor, this.bloomStrength, ...);
// ↑ becomes: new BloomNode(input, uniform(uniform(0.4)), ...)

// After — CORRECT: pass literal numbers
this.bloomNode = bloom(sceneColor, 0.4, 0.3, 0.85);
// Update per-scene via the node's own uniforms:
this.bloomNode.strength.value = newStrength;
```

---

### Bug 6 — Texture 404s (wrong Polyhaven asset IDs)

**Symptom:** All PBR texture requests returned 404.

**Root cause:** Hardcoded Polyhaven asset IDs in `scene-renderer.ts` were wrong — either the IDs never existed or referred to a different naming convention.

| Wrong ID | Correct Polyhaven ID |
|---|---|
| `aerial_grass_rock_02` | `aerial_grass_rock` |
| `light_wood_floor_02` | `wood_floor` |
| `cobblestone_floor_08` | `cobblestone_floor_01` |
| `red_brick_04` | `red_brick_03` |

**Fix:** Updated all hardcoded IDs. Added a `TEXTURE_ALIASES` normalization map in `texture-cache.ts` to also fix IDs from existing agent-generated scene data:

```typescript
const TEXTURE_ALIASES: Record<string, string> = {
  marble:         "marble_01",
  cobblestone:    "cobblestone_floor_01",
  cobblestone_01: "cobblestone_floor_01",  // lacks ao map
  red_brick:      "red_brick_03",
  wood_floor_02:  "wood_floor",
  aerial_grass:   "aerial_grass_rock",
};
```

---

### Bug 7 — HDRI background JPEG 404

**Symptom:** Sky background JPEG requests returned 404.

**Root cause:** `hdri-cache.ts` used the URL pattern `/HDRIs/jpg/1k/{id}_1k.jpg`, which doesn't exist on the Polyhaven CDN. The actual tonemapped JPEG path is different.

**Fix:**

```typescript
// Before — wrong path
const JPEG_CDN = "https://dl.polyhaven.org/file/ph-assets/HDRIs/jpg/1k";
// URL: /HDRIs/jpg/1k/{id}_1k.jpg  ← 404

// After — correct path
const JPEG_CDN = "https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG";
// URL: /HDRIs/extra/Tonemapped%20JPG/{id}.jpg  ← 200
```

---

## Polyhaven CDN Reference

```
HDR environment (2k):
  https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/{id}_2k.hdr

Sky background JPEG (tonemapped):
  https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/{id}.jpg

PBR texture maps (1k JPG):
  https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{id}/{id}_{map}_1k.jpg
  map = diff | nor_gl | rough | ao | disp
```

Note: Not all textures have all maps. Missing maps return 404 and are silently ignored.

---

## Verification

```bash
# TypeScript — zero errors
cd viewer && npx tsc --noEmit

# Browser: Chrome 113+ required (WebGPU)
npm run dev  # → http://localhost:5173
```

Confirm in DevTools:
- No WebGL context (only WebGPU)
- Bloom on emissive objects (neon, torches)
- Sky renders with `SkyMesh`
- Water surfaces use `WaterMesh` auto-animation
- `sceneCode` can use `tsl.time`, `tsl.oscSine`, `MeshStandardNodeMaterial`
