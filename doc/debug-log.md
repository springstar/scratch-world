# Debug Log: Initial Startup Issues

Date: 2026-03-17

## Issue 1: Viewer URL pointing to wrong port

**Symptom:** `presentScene()` was sending `http://localhost:3001/scene/...` to the user, but 3001 is the backend API port, not the viewer app.

**Root cause:** `VIEWER_BASE_URL` was not set in `.env`, so it defaulted to `http://localhost:${VIEWER_API_PORT}` (3001). In development, the viewer app runs on Vite's dev server (5173), which proxies API calls to 3001.

**Fix:** Set `VIEWER_BASE_URL=http://localhost:5173` in `.env`. The Vite dev server handles proxying `/scenes`, `/interact`, and `/realtime` to the backend.

---

## Issue 2: WebSocket not proxied in Vite dev server

**Symptom:** Viewer app's `connectRealtime()` would fail to establish a WebSocket connection in dev mode.

**Root cause:** `viewer/vite.config.ts` only proxied HTTP routes (`/scenes`, `/interact`), not the WebSocket endpoint (`/realtime`).

**Fix:** Added WebSocket proxy entry:
```typescript
"/realtime": { target: "ws://localhost:3001", ws: true },
```

---

## Issue 3: `ANTHROPIC_BASE_URL` not applied to model

**Symptom:** Agent was using `api.anthropic.com` instead of ofox proxy, causing auth failures.

**Root cause:** pi-ai's `getModel()` returns a model object with a hardcoded `baseUrl`. Setting `ANTHROPIC_BASE_URL` in `.env` had no effect without explicitly assigning it to the model object.

**Fix:** In `agent-factory.ts`, mutate the model's `baseUrl` after calling `getModel()`:
```typescript
const model = getModel("anthropic", "claude-sonnet-4-6");
if (process.env.ANTHROPIC_BASE_URL) {
    model.baseUrl = process.env.ANTHROPIC_BASE_URL;
}
```

---

## Issue 4: Wrong model ID for ofox

**Symptom:** Agent completed with `reply length: 0`. No text delta events, no tool calls. `onPayload` log showed the request was going to ofox with model `claude-sonnet-4-20250514`.

**Diagnosis steps:**
1. Added event logging in `_dispatch` — saw `agent_start/turn_start/message_start/message_end/agent_end` but no `message_update` or `text_delta`
2. Added `onPayload` callback — confirmed `baseUrl` was correct but model ID was `claude-sonnet-4-20250514`
3. Tested ofox API directly with curl — got `{"error":{"message":"Model 'claude-sonnet-4-20250514' not found"}}`
4. Tested `claude-sonnet-4-5` — worked

**Root cause:** ofox does not support the Anthropic date-suffixed model ID format (`claude-sonnet-4-20250514`). It uses the short form (`claude-sonnet-4-6`).

**Fix:** Changed `agent-factory.ts` to use `claude-sonnet-4-6` which is both a valid pi-ai type and recognized by ofox.

---

# Debug Log: Scene Quality Improvements & Rendering Flicker

Date: 2026-03-21

## Issue 5: Visible flickering when rotating the 3D scene

**Symptom:** After adding EffectComposer + UnrealBloomPass (post-processing bloom), rotating the camera in the Three.js viewer caused明显的 visible flickering throughout the scene.

### Diagnosis path

**First hypothesis: tone mapping double-application**

Initial fix set `renderer.toneMapping = THREE.NoToneMapping` to prevent double tone mapping between the renderer and `OutputPass`. This did not resolve the flickering.

**Second hypothesis: EffectComposer ↔ MSAA conflict**

Removed EffectComposer entirely and reverted to `renderer.render()` directly. The user confirmed the flickering persisted — proving post-processing was never the cause.

**Root cause (confirmed):** Two independent issues stacking:

1. **Shadow camera frustum too small (primary cause)**
   - `DirectionalLight.shadow.camera` defaults to `left/right/top/bottom = ±5` units
   - Scene objects are spread over `±20` units; objects outside the ±5 frustum have no shadow or incorrect shadow boundary
   - As the camera rotates, objects near the ±5 boundary cycle in and out of the shadow frustum, causing abrupt shadow changes that appear as flickering

2. **Z-fighting between ground plane and terrain objects (secondary cause)**
   - `setupGround()` placed a 200×200 plane at `y=0`
   - Court floor geometry sits at `y=0.05`; terrain floor objects at `y=0.075`
   - At grazing camera angles and far distances, the depth precision (near=0.1, far=500) is insufficient to distinguish `y=0` from `y=0.05`, causing depth test instability

### Fix

```typescript
// Expand shadow camera to cover full scene extent (±40 with margin)
this.sun.shadow.camera.left = -40;
this.sun.shadow.camera.right = 40;
this.sun.shadow.camera.top = 40;
this.sun.shadow.camera.bottom = -40;
this.sun.shadow.camera.near = 1;
this.sun.shadow.camera.far = 200;
this.sun.shadow.bias = -0.001;  // also fixes shadow acne

// Move ground plane below y=0 to clear z-fighting
ground.position.y = -0.02;
```

**Commit:** `f8aab75`

### Lessons

- Always set `shadow.camera.left/right/top/bottom` to match the actual scene extent; default ±5 is almost always too small
- Set `shadow.bias = -0.001` as standard practice to prevent shadow acne
- When a ground plane coexists with flat terrain objects, offset it by at least `y=-0.02` to guarantee z-fighting never occurs
- Post-processing (EffectComposer) was a red herring; shadow/z-fighting bugs look identical to rendering pipeline bugs during rotation


---

# Debug Log: Overexposed Scenes in Code Mode

Date: 2026-03-21

## Issue 6: sceneCode scenes appear blown-out/overexposed, especially from top-down view

**Symptom:** Scenes generated with `sceneCode` appear white and washed-out. Looking upward from the bottom of the scene looked fine, but looking down from a bird's eye view showed severe overexposure.

### Diagnosis path

**First hypothesis: LinearToneMapping clipping HDR values**

Without explicit tone mapping, Three.js defaults to `LinearToneMapping` which hard-clips any luminance > 1.0 to pure white. Bright emissive surfaces + bloom pass = large areas of solid white.

**Fix 1:** Set `renderer.toneMapping = THREE.ACESFilmicToneMapping` with `toneMappingExposure = 0.85`. ACES applies an S-curve to compress highlights instead of clipping. Improved the situation but still too bright.

**Fix 2:** Lowered `toneMappingExposure` from 0.85 → 0.7 and clamped `bloomPass.threshold` to a minimum of 0.9 (scenes were specifying `threshold: 0.75`, causing too many surfaces to bloom). Still too bright from top-down view.

**Root cause (confirmed): double lighting**

When `sceneCode` is present, `loadScene()` applies the renderer's built-in `HemisphereLight` + `DirectionalLight` from the env preset *before* calling `executeCode()`. The sceneCode then adds its *own* ambient, directional, and point lights — stacking on top of the renderer lights. Total scene illumination is roughly double.

The asymmetric symptom (fine from below, overexposed from above) was the key diagnostic clue: looking up, the ceiling was the only surface visible, blocking direct light. Looking down, both the renderer's sun and sceneCode's directional light hit every surface simultaneously.

### Fix

```typescript
// In loadScene(), before executeCode():
if (data.sceneCode) {
  this.hemi.intensity = 0;
  this.sun.intensity = 0;
  this.executeCode(data.sceneCode);
  return;
}
// For JSON-mode scenes, preset intensities applied above remain active
```

**Commit:** (pending)

### Lessons

- When `sceneCode` is present, **always zero out renderer built-in lights** before executing — sceneCode takes full ownership of lighting
- The asymmetric overexposure symptom (angle-dependent) is a reliable signal for double-lighting, not a bloom or tone mapping issue
- Use `ACESFilmicToneMapping` with `toneMappingExposure ≈ 0.6–0.7` as baseline for any scene using bloom
- Clamp `bloomPass.threshold` to a floor value (0.9) so scene-authored low thresholds can't cause runaway bloom on ordinary surfaces

---

- Always set `VIEWER_BASE_URL=http://localhost:5173` in dev `.env`
- ofox model IDs use short form without date suffix (e.g. `claude-sonnet-4-6`, not `claude-sonnet-4-20250514`)
- pi-ai does not read `~/.pi/agent/models.json` — that file is for the pi-agent CLI only
- Debug stubs left in code (`[agent]`, `[dispatch]` logs) should be removed before production

---

# Debug Log: Rigged NPC Animation Incompatibility

Date: 2026-04-29

## Issue 7: Rigged NPC character — arms collapse into chest, feet show sole, body looks compressed

**Symptom:** After adding skeletal animation to an AI-rigged NPC GLB, the character displayed:
- Arms sinking into the torso instead of folding in front of the chest
- Feet rotated ~73° around local X-axis, exposing the dark shoe sole toward the camera (appeared as a "dark block" at the feet)
- Body posture compressed/wrong when compared to the same model without animation (bind pose looked correct)

The non-rigged NPC in the same scene (`潇洒哥`, `hasSkinnedMesh=false`) displayed correctly throughout.

### Diagnosis path

**Step 1: Ruled out orientUpright compounding**

`orientUpright()` was applying -90°X to the group. The root bone animation also carries a constant -90°X quaternion `[-0.707,0,0,0.707]`. Combined, this produced -180°X in `bone.matrixWorld`, and with the root bone IBM of +90°X the net skin matrix was -90°X on all vertices — character collapsed entirely.

Fix: skip `orientUpright` for any group containing a `SkinnedMesh` (`hasSkinnedMesh` flag).

**Step 2: Ruled out bounding-box ground offset**

`meshOnlyBoundingBox` showed `Y=[0.000,1.800]` for the bind pose — the model is natively Y-up, feet at local y=0. Applying the standard `-bbox.min.y` offset was a no-op. Confirmed `groundOffset=0` is correct for SkinnedMesh.

**Step 3: Identified contact shadow oversizing**

Original code: `Box3.setFromObject(group)` included the full SkinnedMesh unskinned Z-extent (~1.9m for Z-up models), producing a 2.85m diameter shadow that appeared as a solid dark rectangle at the feet. Fixed by computing shadow diameter from the actual XZ bbox span (`max(xSpan, zSpan) × 1.5`), giving ~0.69m for this character.

**Step 4: Identified root cause — rig/animation mismatch**

Diagnostic logs of `Idle_FoldArms_Loop` first-frame bone quaternions:
```
root.q0=    [-0.707, 0.000, 0.000, 0.707]   (-90°X — normal for Blender export)
pelvis.q0=  [ 0.756,-0.088,-0.075, 0.644]   (|w|=0.644 → ~100° deviation from bind)
spine_01.q0=[-0.065, 0.000, 0.000, 0.998]   (small, ~7°, fine)
foot_l.q0=  [-0.495, 0.022, 0.092, 0.863]   (~60° rotation → plantar flexion)
foot_r.q0=  [-0.578,-0.050,-0.164, 0.798]   (~73° rotation → sole facing camera)
```

A properly retargeted Mixamo standing-idle has pelvis barely deviating from bind pose (`|w| ≈ 0.99`). The `|w|=0.644` value for this model's pelvis means the animation expects a skeleton with bone orientations **completely different from this model's actual bind pose**. The animations were almost certainly authored for a standard Mixamo rig and embedded in the GLB without retargeting to the actual skeleton's bone axes. Because all bones are mismapped, every animated bone drives the mesh in the wrong direction — hence arms collapse inward and feet hyperextend.

**Root cause confirmed:** The AI rigging tool created a skeleton with non-standard bone orientations (local axes differ from Mixamo's expected axes). The embedded Mixamo animation tracks contain quaternions relative to Mixamo's expected bone coordinate systems. When played through Three.js's `AnimationMixer`, each bone quaternion is applied in the rig's actual local space, producing incorrect deformations.

### Fix

Heuristic detection: at animation setup time, check the `pelvis.quaternion` first-frame `w` component. If `|w| < 0.8` (rotation > ~37° from bind pose in a supposedly neutral idle), the animation is incompatible with this skeleton's bind pose. Fall back to bind pose (no animation) and log a warning.

```typescript
const pelvisQt = idleClip.tracks.find((t) => t.name === "pelvis.quaternion");
const pelvisW0 = pelvisQt && pelvisQt.values.length >= 4 ? pelvisQt.values[3] : 1;
const animCompatible = Math.abs(pelvisW0) >= 0.8;
if (!animCompatible) {
  console.warn(`[NPC anim] animation skipped — pelvis w=${pelvisW0.toFixed(3)} < 0.8 (rig/animation mismatch). Re-rig model via Mixamo to fix.`);
}
```

This detects the mismatch automatically without per-model configuration, and allows correctly retargeted models to animate normally.

### Additional fixes in same session

- `createContactShadow`: shadow diameter now uses `max(xSpan,zSpan) × 1.5` from actual XZ bbox instead of a fixed 0.8m override
- Shadow plane `groundY + 0.002` (was `+0.01`) to minimize clipping into shoe soles at foot level
- Shadow `renderOrder: 1` (was `-1`) so it composites correctly over the Gaussian Splat terrain

### To properly fix a broken-rigged model

1. Take the **original unrigged mesh** (before AI auto-rigging)
2. Upload to [mixamo.com](https://www.mixamo.com) → Auto-rig → download GLB with animations
3. Mixamo-rigged models have bone orientations exactly matching the Mixamo animation pack — no retargeting artifacts

### Lessons

- `pelvis.quaternion[w]` in a standing idle is a reliable health check: `|w| ≥ 0.95` = healthy, `|w| < 0.8` = broken rig
- AI auto-rigging tools (Anything World, Tripo, etc.) may produce correct bone names but wrong bone local axes — Mixamo compatibility is not guaranteed without testing
- `Box3.setFromObject(skinnedMesh)` returns **unskinned** (bind-pose) geometry bounds — these may be in Z-up Blender space even after GLTF loading; use `meshOnlyBoundingBox` and cross-check Y vs Z extents before using for shadow sizing or ground placement
- `orientUpright` must be **skipped** for SkinnedMesh — applying a group rotation compounds with animated root bone rotation, collapsing the entire skeleton
