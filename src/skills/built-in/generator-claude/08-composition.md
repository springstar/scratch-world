## Scene Composition Rules

Good composition is the difference between a technically correct scene and one that reads as real. These rules apply to ALL scenes regardless of type.

---

### Rule 1 — Three depth layers (MANDATORY)

Every scene must have objects placed in all three depth zones relative to the camera:

| Layer | Distance from camera | Purpose |
|---|---|---|
| **Foreground** | 0–6 m | Grounds the viewer, creates intimacy |
| **Midground** | 6–25 m | Dominant anchor, main action |
| **Background** | 25–200 m | Context, atmosphere, scale reference |

A scene with only midground objects looks like a diorama on a blank stage. A scene missing foreground feels weightless.

**Foreground examples**: a rock, a lantern post, a bush, a puddle, a fence segment, a fallen log.

```javascript
// WRONG — only midground
stdlib.makeBuilding({ position: { x: 0, y: 0, z: -10 } });

// CORRECT — all three layers
stdlib.makeTerrain("platform", { position: { x: 1.5, y: 0, z: -2 } });   // FG rock/step
stdlib.makeBuilding({ position: { x: 0, y: 0, z: -12 } });               // MG anchor
stdlib.makeTerrain("hill", { position: { x: -20, y: 0, z: -60 } });      // BG hill
```

---

### Rule 2 — Camera placement: rule of thirds

Place the dominant anchor at one of the four rule-of-thirds intersections, NOT at dead center.

```javascript
// Scene width W, depth D. Default camera at z=+12 looking toward -z.
// Anchor at x ≈ ±W/6, z ≈ -D/3  (one third in from edge and depth)
const vp = L.viewpoint("default");
// Offset camera slightly off-axis
camera.position.set(vp.position.x + 2, vp.position.y, vp.position.z);
controls.target.set(vp.lookAt.x - 3, vp.lookAt.y * 0.8, vp.lookAt.z);
```

Camera height: **eye-level (1.5–2 m) for intimacy**, elevated (5–8 m) for revealing layout, aerial (20+ m) only for maps/overviews. Default to eye-level unless the scene needs spatial overview.

---

### Rule 3 — Size gradient confirms depth

Objects must shrink predictably with depth. If a background tree is the same apparent size as a foreground tree, depth collapses.

- Foreground trees/rocks: 1× base scale
- Midground: 1× (real scale)
- Background hills/peaks: use `makeKarstPeak`, `makeTerrain("hill")` with large `width`/`height` — they are far away, so world-scale size is large

Never place equal-sized copies of the same object at different depths without scale variation.

---

### Rule 4 — Object overlap creates depth

Objects that partially occlude each other signal layering. Avoid placing everything in a flat line at the same z.

```javascript
// BAD — flat row, no overlap
for (let i = 0; i < 5; i++) stdlib.makeBuilding({ position: { x: i * 8, y: 0, z: -10 } });

// GOOD — staggered z, foreground objects overlap midground
stdlib.makeBuilding({ position: { x: -4, y: 0, z: -8  } });
stdlib.makeBuilding({ position: { x:  3, y: 0, z: -14 } });
stdlib.makeBuilding({ position: { x: -1, y: 0, z: -20 } });
```

---

### Rule 5 — Atmospheric perspective

Fog is not optional for outdoor scenes with depth > 30 m. It pushes background objects back visually.

```javascript
// Use FogExp2 — more realistic than linear Fog
scene.fog = new THREE.FogExp2(0x9ab0c0, 0.018);  // light overcast
scene.fog = new THREE.FogExp2(0xd4b870, 0.008);  // desert haze
scene.fog = new THREE.FogExp2(0x9ab0aa, 0.022);  // 湘西 mist
```

Do NOT use `fog = null` for outdoor scenes unless specifically desert/clear-sky at altitude.

---

### Rule 6 — Negative space is intentional

Crowding every part of the frame destroys realism. Real environments have empty zones (sky, ground, open water). Leave at least 30% of the viewport as intentional empty space (sky, open ground, calm water surface).

---

### Pre-code composition checklist

Before writing `sceneCode`, answer these in your reasoning:

1. Where is the foreground element? (must be within 6 m of camera)
2. Where is the dominant anchor? (must occupy 40%+ of midground viewport)
3. Where is the background context? (hills, peaks, distant buildings — at least 40 m back)
4. Is the camera off-center from the anchor? (rule of thirds)
5. Are there 2–3 depth zones with overlapping objects?
6. Is fog set for the atmosphere?
