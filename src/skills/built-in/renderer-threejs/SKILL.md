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
| `terrain` | `floor` | Flat surface panel (20×20) |
| `terrain` | `wall` | Vertical wall slab (8×3) |
| `terrain` | `ceiling` | Ceiling panel (20×20) |
| `terrain` | `court` | Basketball court with hardwood floor, center line, three-point arcs, key areas |
| `object` | `desk` / `table` | Desk with four legs |
| `object` | `chair` / `stool` | Chair with backrest |
| `object` | `blackboard` | Green chalkboard with optional chalk writing |
| `object` | `window` | Transparent glass window frame |
| `object` | `door` | Wooden door panel |
| `object` | `shelf` / `bookcase` | Tall shelf unit |
| `object` | `pillar` / `column` | Cylindrical column |
| `object` | `hoop` | Basketball hoop (pole + arm + backboard + rim + net); auto-mirrors for right-side hoop |
| `object` | `box` | Generic box (default fallback) |
| `tree` | — | Trunk + conical foliage, random scale/rotation |
| `building` | — | Box body + pyramid roof |
| `npc` | — | Capsule-shaped character |
| `item` | — | Cylinder-shaped collectible |

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

## Post-Processing (available, not yet enabled)

The viewer supports these effects (can be activated in `scene-renderer.ts`):
- **Bloom** — glow on emissive surfaces
- **SSAO** — ambient occlusion for depth
- **Depth of Field** — bokeh blur for cinematic focus
- **Vignette** — subtle edge darkening

When generating scenes with strong light sources (neon signs, fires, windows) or scenes that
benefit from depth (long corridors, outdoor vistas), note this in `description` fields as hints
for future post-processing passes.
