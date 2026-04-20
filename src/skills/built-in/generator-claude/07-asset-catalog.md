## Asset Catalog

The catalog provides verified CC0 GLTF/GLB assets with pre-calibrated scale.
Use `stdlib.placeAsset(id, opts)` instead of `stdlib.loadModel(url)` for cataloged assets — it applies scale automatically.

```typescript
stdlib.placeAsset(id: string, opts?: {
  position?: { x: number; y: number; z: number };
  scale?:    number;   // multiplier ON TOP of catalog calibration (1 = catalog default)
  rotation?: { x?: number; y?: number; z?: number };
  animationClip?: "first" | string | undefined;  // undefined suppresses auto-play for animated entries
}): Promise<THREE.Group>
```

Catalog entries marked ✓ in the **animated** column auto-play their first clip by default.
Pass `animationClip: undefined` to load without animation, or a clip name to select a specific one.

### Discovery: `find_gltf_assets` + `add_to_catalog`

When you need an asset not in this catalog:
1. Call `find_gltf_assets({ query: "...", assetType: "tree" })` — searches for verified GLB URLs.
2. Use the returned URL with `stdlib.loadModel(url, { scale, position })`.
3. After confirming it renders: call `add_to_catalog` — it becomes available via `placeAsset()` in future scenes.

**Do not invent URLs.** Only use URLs returned by `find_gltf_assets` or listed in this catalog.

---

### Seed Catalog (all verified 200 OK as of 2026-03-30)

| id | type | tags | scale | animated | notes |
|---|---|---|---|---|---|
| `character_soldier` | character | soldier, military, humanoid | 1 | ✓ | Rigged military figure. three.js examples. |
| `character_xbot` | character | humanoid, robot, male | 1 | ✓ | Generic rigged male humanoid. three.js. |
| `character_michelle` | character | humanoid, female, dance | 1 | ✓ | Rigged female humanoid with dance clip. three.js. |
| `character_robot_expressive` | character | robot, cartoon, expressive | 1 | ✓ | Cartoon robot with facial expressions. three.js. |
| `character_cesium_man` | character | humanoid, male, walk | 1 | ✓ | Rigged walking humanoid. KhronosGroup. |
| `character_brainstem` | character | humanoid, detailed | 1 | ✓ | High-detail rigged character. KhronosGroup. |
| `animal_horse` | animal | horse, mammal | 0.012 | ✓ | Galloping horse. Very small units → scale=0.012. |
| `animal_parrot` | animal | bird, parrot, tropical | 0.012 | ✓ | Flying parrot. groundOffset=0.6 (hovers). |
| `animal_flamingo` | animal | bird, flamingo, tropical | 0.012 | ✓ | Flamingo. three.js. |
| `animal_stork` | animal | bird, stork, flying | 0.012 | ✓ | Flying stork. three.js. |
| `animal_fox` | animal | fox, forest, mammal | 0.02 | ✓ | Rigged fox. KhronosGroup. |
| `animal_fish` | animal | fish, aquatic | 1 | — | Barramundi fish. groundOffset=0.3. |
| `animal_duck` | animal | duck, toy, yellow | 0.01 | — | Rubber duck. Very small units → scale=0.01. |
| `vehicle_milk_truck` | vehicle | truck, vintage, delivery | 1 | ✓ | Classic milk truck (animated wheels). KhronosGroup. |
| `vehicle_car_toy` | vehicle | car, toy, miniature | 80 | — | Miniature toy car. Very small units → scale=80. |
| `prop_lantern` | prop | lantern, lamp, chinese, asian | 1 | — | Chinese hanging lantern. Good for Asian scenes. |
| `prop_antique_camera` | prop | camera, vintage, antique | 1 | — | Vintage film camera. |
| `prop_iridescence_lamp` | prop | lamp, modern, light | 1 | — | Modern iridescent floor lamp. |
| `prop_water_bottle` | prop | bottle, glass, transparent | 8 | — | Glass water bottle with transmission. |
| `prop_boom_box` | prop | boombox, radio, retro | 80 | — | Retro 80s boombox. Very small units → scale=80. |
| `prop_damaged_helmet` | prop | helmet, scifi, damaged | 1 | — | Sci-fi damaged helmet. |
| `prop_avocado` | prop | food, fruit | 100 | — | Photogrammetry avocado. Very small → scale=100. |
| `prop_corset` | prop | clothing, fabric, vintage | 10 | — | Victorian corset. scale=10. |
| `furniture_chair_sheen` | furniture | chair, indoor, fabric | 1 | — | Upholstered velvet chair. |
| `furniture_sofa_velvet` | furniture | sofa, indoor, velvet | 1 | — | Glamour velvet sofa. |
| `nature_littlest_tokyo` | nature | japanese, city, diorama, buildings | 0.01 | ✓ | Complete animated Japanese city diorama. Use as centerpiece for Japanese scenes. |
| `plant_indoor_01` | nature | plant, indoor, potted, foliage, tropical, leaf | 1 | — | Tropical potted plant with diffuse-transmission leaves. Use for interior greenery, tropical scenes, café/restaurant props. |

> The catalog grows as you call `add_to_catalog` with discovered assets.

---

### Trees: fallback hierarchy

There are currently **no standalone tree GLBs** in the catalog. Use this priority order:

1. **Call `find_gltf_assets`** with query `"low poly tree glb CC0 free"` (plus tree type: pine/oak/palm/cherry) — this may find a verified CDN URL.
2. If `find_gltf_assets` returns nothing useful: **call `stdlib.makeTree()`** — the procedural fallback. It now produces varied crowns (8–12 sphere clusters), tapered trunk with bark PBR, and seed-based leaf-color variation per tree. Not photorealistic, but visually coherent for crowds of trees.
3. **Never** use raw `CylinderGeometry` + single `SphereGeometry` directly in sceneCode — that is strictly worse than `makeTree()`.

```javascript
// Worst (never do this):
const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 3, 8), mat);
const crown = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), leafMat);

// Correct fallback — varied, seed-stable, bark PBR:
stdlib.makeTree({ position: { x: 5, y: 0, z: -8 } });
stdlib.makeTree({ position: { x: -3, y: 0, z: -12 }, scale: 1.3 });
```

---

### Usage Examples

```javascript
// Soldier standing in scene
stdlib.placeAsset("character_soldier", { position: { x: 2, y: 0, z: 0 } });

// Chinese lantern hanging above a gate (placed at elevation)
stdlib.placeAsset("prop_lantern", {
  position: { x: 0, y: 3.5, z: -3 },
  rotation: { y: Math.PI / 4 },
});

// Japanese scene — use the diorama as the dominant anchor
stdlib.placeAsset("nature_littlest_tokyo", {
  position: { x: 0, y: 0, z: -5 },
  scale: 2,  // 2× catalog default
});

// Discover a pine tree not in catalog
// 1. Call: find_gltf_assets({ query: "pine tree low poly glb free CC0", assetType: "tree" })
// 2. Use the best URL:
const treeUrl = "https://..."; // from find_gltf_assets result
stdlib.loadModel(treeUrl, { scale: 1, position: { x: -5, y: 0, z: -8 } });
// 3. Call: add_to_catalog({ id: "tree_pine_01", url: treeUrl, type: "tree", ... })
```

### Scale Reference

- three.js animals (Horse, Parrot, Flamingo, Stork) are in large units → scale ≈ 0.01–0.02
- KhronosGroup Duck, Avocado: millimetre-scale → scale = 0.01 or 100
- Quaternius / Kenney assets: typically metre-scale → scale = 1
- When in doubt: test with scale=1, a standing human should be ~1.7 units tall at the camera

---

## Particle & Effects Texture Catalog

Pre-built textures available at `/assets/particles/`. Use with `THREE.TextureLoader` in sceneCode or WorldAPI code.

| path | description | best use |
|------|-------------|----------|
| `/assets/particles/disc.png` | Soft white circle, alpha-edged | Generic particle dot, snow, rain, bubbles |
| `/assets/particles/spark1.png` | Star-shaped spark | Fireworks burst, magic sparkle, welding sparks |
| `/assets/particles/snowflake1.png` | Six-arm snowflake | Snow particles, ice effects |
| `/assets/particles/snowflake2.png` | Alternate snowflake | Snow blizzard variety |
| `/assets/particles/lensflare0.png` | Large soft glow (512×512) | Sun flare, explosion center, portal glow |
| `/assets/particles/lensflare3.png` | Small hexagonal flare | Secondary lens flare rings, bokeh |

### Usage pattern (sceneCode / WorldAPI)

```javascript
// Always use Points + custom ShaderMaterial for best performance
const tex = new THREE.TextureLoader().load('/assets/particles/spark1.png');
const geo = new THREE.BufferGeometry();
const count = 200;
const pos = new Float32Array(count * 3);
// ... fill positions ...
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
const mat = new THREE.PointsMaterial({
  map: tex,
  size: 0.3,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true,
});
scene.add(new THREE.Points(geo, mat));
```

**Rules:**
- Always set `depthWrite: false` and `blending: THREE.AdditiveBlending` for fire/glow/explosion effects.
- Use `sizeAttenuation: true` so particles scale with distance.
- For fireworks: use `spark1.png` for burst particles, `lensflare0.png` for the launch trail glow.
- For snow/rain: use `disc.png` or `snowflake1.png`.
- **Do not invent texture URLs.** Only use paths from this table or user-uploaded paths from scene context.

---

## Physics Property Reference (for `place_prop` in Marble/splat scenes)

Use this table when calling `place_prop` to set `physicsShape`, `mass`, and `scale` for interactive objects. Values are real-world estimates — prefer the nearest category.

| Category | Examples | physicsShape | mass (kg) | Notes |
|---|---|---|---|---|
| **Light prop** | water bottle, apple, book, coffee cup | `box` | 0.5–2 | Small tabletop items; easy to knock over |
| **Medium prop** | wooden crate, barrel, briefcase, toolbox | `box` | 15–50 | Stack-able, player can push |
| **Heavy prop** | steel drum, large crate, concrete block | `box` | 80–200 | Barely movable; player can lean on |
| **Sphere prop** | ball, globe, cannonball, orange, melon | `sphere` | 0.5–10 | Rolls naturally with `sphere` collider |
| **Furniture** | chair, stool, small table | `box` | 5–20 | Chairs tip easily — keep mass low |
| **Vehicle (light)** | bicycle, cart, canoe | `convex` | 15–80 | Irregular shape needs `convex` |
| **Vehicle (heavy)** | car, truck, boat | `convex` | 500–2000 | Static or barely movable |
| **Weapon/tool** | sword, axe, shovel, spear | `box` | 1–5 | Thin — `box` close enough |
| **Container (open)** | basket, bucket, bowl | `convex` | 1–5 | Rim profile → `convex` |
| **Natural object** | rock, log, boulder | `convex` | 5–500 | Irregular → `convex`; use mass for size |
| **Electronic** | TV, monitor, computer | `box` | 5–30 | Boxy — `box` works |
| **NPC (static)** | mannequin, statue, effigy | `box` | 999 | High mass = player cannot move |

### Quick rules

- Default when unsure: `physicsShape: "box"`, `mass: 10`
- `sphere` ONLY for objects that genuinely roll (balls, globes)
- `convex` for organic/irregular shapes (rocks, logs, vehicles) — costs more GPU but fits better
- `mass > 200` makes objects player-immovable (they act as scenery)
- `scale` multiplies the catalog calibration — check the Asset Catalog scale column first
