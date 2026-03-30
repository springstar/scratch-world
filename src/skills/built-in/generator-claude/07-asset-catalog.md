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
