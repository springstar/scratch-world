# renderer-threejs

Three.js rendering capabilities reference for scratch-world. Use this to understand what the viewer
can render when generating sceneData — the richer the sceneData, the better the visual output.

Source: [Dexploarer/threejs-scene-builder](https://smithery.ai/skills/Dexploarer/threejs-scene-builder)

---

## What the Viewer Can Render

The viewer (`viewer/src/renderer/scene-renderer.ts`) renders `SceneData` using Three.js.
When generating sceneData, use this reference to know what shapes, effects, and behaviors are supported.

### Supported Object Types & Shapes

| type | shape (metadata.shape) | Visual result |
|---|---|---|
| `terrain` | `water` | Animated reflective water surface (Three.js Water shader); `position.y` = water level; `metadata.width/depth` control size (default 20×20) |
| `terrain` | `floor` | Flat surface panel; `metadata.width/depth` control size (default 20×20); PBR texture auto-selected from name (grass / stone / wood); override with `metadata.texture` (Polyhaven asset ID) |
| `terrain` | `wall` | Wall slab (20×3.2); auto-rotates 90° for side walls placed at ±x |
| `terrain` | `ceiling` | Ceiling panel (20×20) |
| `terrain` | `court` | Basketball court with hardwood floor, center line, three-point arcs, key areas |
| `terrain` | `hill` | Rounded green dome; `position.y` = peak; `metadata.width` = footprint radius, `metadata.height` = peak height |
| `terrain` | `cliff` | Tall grey rock face; `position.y` = top edge; `metadata.width/height/depth` control shape |
| `terrain` | `platform` | Raised flat slab; `position.y` = top surface; `metadata.width/height/depth` control shape |
| `object` | `desk` / `table` | Desk top + 4 cylindrical legs |
| `object` | `chair` / `stool` | Seat + backrest + 4 legs |
| `object` | `blackboard` | Dark green chalkboard with wooden frame, chalk tray; **text from `description` rendered automatically via CanvasTexture** |
| `object` | `window` | Window frame + transparent glass pane |
| `object` | `door` | Door frame + panelled door + gold knob |
| `object` | `shelf` / `bookcase` | Shelf unit with back panel, 5 shelves, randomly coloured books |
| `object` | `pillar` / `column` | Cylindrical column |
| `object` | `hoop` | Basketball hoop (pole + arm + backboard + rim + net); auto-mirrors for right-side hoop |
| `object` | `box` | Generic box (default fallback) |
| `tree` | — | Tapered trunk + 3-layer spheroid foliage; scale/rotation varies by position |
| `building` | — | Box body + pyramid roof + glass windows + door |
| `npc` | — | Multi-part humanoid: legs, torso, arms, neck, head, hair; deterministic clothing colour from position |
| `item` | — | Cylinder-shaped collectible |

### Position & Y Coordinate Rules (CRITICAL)

These rules determine correct placement. Wrong y values cause objects to float or sink:

| Object | Correct `position.y` | Notes |
|---|---|---|
| `terrain/floor` | `0` (or desired surface elevation) | Top surface at y+0.075 |
| `terrain/hill` | desired **peak height** (e.g. `4`) | Dome descends from this peak |
| `terrain/cliff` | desired **top edge** height (e.g. `8`) | Rock face descends below |
| `terrain/platform` | desired **top surface** height (e.g. `3`) | Slab hangs below this level |
| `terrain/wall` | **half of wall height** (e.g. `1.6` for a 3.2 m room) | Renderer uses y as the wall center |
| `terrain/ceiling` | room height (e.g. `3.2`) | Renderer uses y directly |
| `object/*` (furniture) | **surface y it stands on** | Renderer builds upward from this y |
| `npc` | **surface y it stands on** | Renderer places feet at y |
| `tree`, `building` | **surface y it stands on** | Renderer builds upward from y |

### Environment Settings

```json
{
  "skybox": "clear_day | sunset | night | overcast",
  "timeOfDay": "dawn | noon | dusk | night",
  "ambientLight": "warm | cool | neutral",
  "weather": "clear | foggy | rainy"
}
```

Each combination changes sky color, fog, sun position, and light intensity automatically.

---

## Material Capabilities

The renderer uses PBR (Physically Based Rendering) materials:

```typescript
// Standard: roughness + metalness + optional maps
MeshStandardMaterial({ color, roughness, metalness, normalMap, roughnessMap })

// Glass / transparent
MeshPhysicalMaterial({ transmission: 1, roughness: 0, thickness: 0.5 })

// Glow / emissive
MeshStandardMaterial({ emissive: color, emissiveIntensity: 0.5 })
```

**When generating objects**, you can hint at material appearance through `description`:
- "polished metal surface" → low roughness, high metalness
- "rough stone wall" → high roughness, low metalness
- "glowing neon sign" → emissive material

---

## Procedural Generation Patterns

The renderer can handle procedurally generated content. When generating large scenes:

### Repeated Elements (Instancing)
For scenes with many identical objects (audience seats, trees in a forest, pillars in a hall),
place them as individual SceneObjects — the renderer batches similar geometries.

### Terrain Variation
For outdoor scenes, spread `terrain` objects (ground tiles) at varying y heights to suggest
elevation changes. Use multiple `tree` and `building` objects at varied positions and scales.

### Building Interiors
For indoor scenes (classroom, office, lab):
- One `terrain/floor` at center
- Four `terrain/wall` objects at ±x and ±z edges, rotated appropriately
- One `terrain/ceiling` at center
- Furniture as `object` with appropriate shapes

---

## Character & NPC Capabilities

NPCs render as capsule-shaped figures (`type: "npc"`). To place characters in a scene:

```json
{
  "objectId": "npc_teacher",
  "type": "npc",
  "name": "Teacher at the blackboard",
  "position": { "x": 0, "y": 0, "z": -8 },
  "interactable": true,
  "interactionHint": "talk to the teacher"
}
```

Multiple NPCs can be placed at different positions. Use descriptive names and interaction hints
to make them feel alive.

---

## Animation-Ready Objects

Stateful objects support interaction-driven state changes (rendered differently per state):

```json
{
  "metadata": {
    "shape": "blackboard",
    "state": "written",
    "transitions": { "erase": "erased", "write": "written" }
  }
}
```

Supported stateful shapes:
- `blackboard` — `written` shows chalk overlay; `erased` / `clean` hides it
- `door` — `open` / `closed` (future)
- Any object — use `state` for narrative context even if no visual change yet

---

## Performance Guidelines for Scene Generation

- **8–16 objects** is the recommended range for smooth rendering
- Avoid placing more than 4 `wall` objects (expensive shadow casting)
- For large outdoor scenes, use 1 `terrain/floor` + multiple scattered `tree` / `building`
- Basketball/sports courts: use 1 `terrain/court` + 2 `object/hoop` (not individual floor tiles)
- Viewpoints: 2–3 per scene, placed at human eye height (y ≈ 1.7) or elevated overview (y ≈ 8–12)

---

## Post-Processing Effects

The viewer now ships with an `EffectComposer` + `UnrealBloomPass` active on every frame.

### Bloom (always on, configurable)

Default settings: strength=0.4, radius=0.3, threshold=0.85 (subtle global glow).
Configure per-scene via `environment.effects.bloom`:

```json
{
  "environment": {
    "skybox": "night",
    "effects": {
      "bloom": { "strength": 1.2, "radius": 0.4, "threshold": 0.7 }
    }
  }
}
```

Night scenes auto-boost bloom strength to 0.8 minimum. Objects with emissive materials (neon signs, glowing windows) benefit most.

---

## GLTF Model Loading

Any object can load a real 3D GLTF/GLB model by setting `metadata.modelUrl`. A placeholder primitive shows while loading; on success it is replaced by the real model.

```json
{
  "objectId": "obj_helmet",
  "name": "Damaged flight helmet",
  "type": "item",
  "position": { "x": 2, "y": 0, "z": 0 },
  "metadata": {
    "modelUrl": "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/DamagedHelmet/glTF/DamagedHelmet.gltf",
    "scale": 1.5,
    "yOffset": 0.5
  }
}
```

Metadata fields:
- `modelUrl` (string) — GLTF or GLB URL (must be CORS-accessible)
- `scale` (number, default 1) — uniform scale for the loaded model
- `yOffset` (number, default 0) — vertical offset to correct ground alignment

On load error, the placeholder remains and a console warning is logged.

---

## Code Generation Mode (sceneCode)

For scenes that need full Three.js control — particle systems, animations, procedural geometry — `SceneData.sceneCode` lets Claude supply a JS function body that runs in a sandbox:

```
Sandbox: { THREE, scene, camera, renderer, controls, animate }
```

When `sceneCode` is present, the renderer skips JSON object building and calls `executeCode()` instead. The `animate(cb)` function registers a per-frame callback receiving `delta` (seconds since last frame).

---

## Post-Processing (available, now enabled)

The viewer ships these effects (active by default):
- **Bloom** — glow on emissive surfaces (UnrealBloomPass, configurable per scene)

Future additions can be added as new passes to `EffectComposer` in `scene-renderer.ts`.

