# generator-claude

## create_city — Procedural City Generation

Use `create_city` when the user asks for a **city, town, village, settlement, or commercial district**.
Use `create_scene` for nature landscapes, sports fields, abstract scenes, rooms, or anything else.

Parameters:
- `prompt`  — describe theme and atmosphere
- `theme`   — `"medieval"` (default) | `"fantasy"` | `"modern"`
- `size`    — `"village"` | `"town"` (default) | `"city"`
- `seed`    — optional integer for reproducible layout

The tool auto-generates roads, building placement, trees, and NPCs.

---

When the user asks you to create or update a scene, you MUST include a `sceneData` argument in your `create_scene` or `update_scene` tool call. Do NOT omit `sceneData` — without it the system cannot render your scene.

Alternatively, for scenes requiring complex animations or custom visuals, use **Code Generation Mode** (see below).

## SceneData JSON Schema

The `sceneData` field must be a JSON object with this exact structure:

```json
{
  "environment": {
    "skybox": "clear_day | sunset | night | overcast",
    "timeOfDay": "dawn | noon | dusk | night",
    "ambientLight": "warm | cool | neutral",
    "weather": "clear | foggy | rainy",
    "effects": {
      "bloom": {
        "strength": 0.4,
        "radius": 0.3,
        "threshold": 0.85
      }
    }
  },
  "viewpoints": [
    {
      "viewpointId": "vp_1",
      "name": "descriptive name",
      "position": { "x": 0, "y": 1.7, "z": -8 },
      "lookAt": { "x": 0, "y": 1, "z": 0 }
    }
  ],
  "objects": [
    {
      "objectId": "obj_1",
      "name": "vivid specific name",
      "type": "tree | building | npc | item | terrain | object",
      "position": { "x": 0, "y": 0, "z": 0 },
      "description": "vivid description",
      "interactable": true,
      "interactionHint": "try 'examine the ...'",
      "metadata": {
        "shape": "desk | chair | blackboard | window | door | wall | floor | water | shelf | box | pillar | hoop | court | hill | cliff | platform",
        "state": "current state string if stateful",
        "transitions": { "action verb": "next state" },
        "modelUrl": "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/Duck/glTF/Duck.gltf",
        "scale": 1.0,
        "yOffset": 0,
        "width": 20,
        "depth": 20,
        "height": 4,
        "texture": "polyhaven-asset-id (optional, overrides auto-selected PBR texture for terrain/floor)"
      }
    }
  ]
}
```

## Rules

- Generate **8–16 objects**. Analyse the prompt and choose the most fitting types and shapes.
- **INDOOR scenes** (classroom, room, hall, lab, shop, corridor, etc.):
  - Use type `"terrain"` for floor (shape `"floor"`), walls (shape `"wall"`), ceiling (shape `"floor"`).
  - **MUST include exactly 4 walls** (front, back, left, right) — a room with missing walls looks broken.
  - Wall positions for a room of half-width W and half-depth D: back `z=-D`, front `z=D`, left `x=-W`, right `x=W`. **Wall `y` must equal half the wall height** (e.g. `y: 1.6` for a 3.2m wall). Do NOT set `y: 0` for walls.
  - The blackboard `description` field **must contain the exact text to write on the board** (e.g. `"黑板上写着'数学分析'"`). The renderer reads this field to render chalk text automatically.
  - Use type `"object"` for furniture with the correct shape (`desk`, `chair`, `blackboard`, `window`, `door`, `shelf`, etc.).
  - Use type `"npc"` for people. Use type `"item"` for small pickable items.
  - Do **NOT** add trees or outdoor buildings to indoor scenes.
- **OUTDOOR scenes** (forest, city, park, street, beach, rooftop, **basketball court, tennis court, football field, sports field, playground**, etc.):
  - Use type `"terrain"` for ground and landforms. **Do NOT add walls or ceiling.**
  - Use types `"tree"`, `"building"`, `"npc"`, `"item"`, `"object"` freely.
  - **Outdoor scene minimum specs (CRITICAL — undersized scenes feel like dioramas):**
    - `terrain/floor` width and depth: **≥ 80 × 60** units (anything smaller exposes bare edges and feels cramped)
    - Buildings/trees must be spread **8–15 units apart** — never cluster everything in a 10-unit zone
    - Background layer (z = -15 to -25) must have **at least 2–3** `terrain/hill` objects filling the horizon width. Use `y=0` and set `metadata.height` to control dome height (5–10 for rolling hills, 20–45 for mountain ranges)
    - Foreground layer (z = +8 to +15) should have **loose scatter**: trees, rocks, or small items at varying x positions — the renderer also auto-scatters ambient rocks, but explicit foreground objects greatly help depth
    - Recommended viewpoint: z = 16–22, y = 1.7 (eye-level), lookAt toward scene center
    - `terrain/water` `position.y` should be `0` — **do NOT use negative values**
  - Sports courts and open-air venues are always OUTDOOR — **never add walls or ceiling**.
- **INDOOR arena** (gymnasium, sports hall — only when the prompt explicitly says "indoor" or "gymnasium/体育馆"):
  - Treat as INDOOR and may include walls/ceiling.
- **Sports courts and fields** (basketball court, tennis court, etc.):
  - Use **one** `terrain` object with `shape: "court"` at position `{x:0, y:0, z:0}` for the court floor + line markings.
  - Use **two** `object` items with `shape: "hoop"` at opposite ends (e.g. `x: -13` and `x: 13`, `z: 0`) for basketball hoops.
  - Add surrounding elements freely: `npc` for players, `item` for balls, `object` (shape `box`) for benches/scoreboards, `tree` or `building` for surroundings.
  - Do **NOT** add walls, ceiling, or indoor floor terrain.
- **Stateful objects**: set `metadata.state` (e.g. `"written"`, `"open"`, `"closed"`, `"on"`, `"off"`) and `metadata.transitions` (e.g. `{"erase": "erased", "write": "written"}` for a blackboard).

---

## Open-World Depth & Elevation (CRITICAL for immersive scenes)

A flat scene with everything at `y=0` looks like a tabletop game, **not** an open world. Follow these rules for any outdoor or large-scale scene.

### Three-layer depth composition

Divide the scene into three depth bands along the **z axis**:

| Layer | z range | Purpose | Example objects |
|---|---|---|---|
| **Foreground** | z = +5 to +15 (nearest to camera) | Detail, texture, interactables | NPC, items, low rock, flowers |
| **Midground** | z = -5 to +5 (scene focus) | Main action, focal points | Buildings, trees, court, shrine |
| **Background** | z = -15 to -25 (far horizon) | Scale, atmosphere, world edge | Distant mountains, cliff faces, forest wall |

- Background objects should be **larger** (scale 1.5–3×) and slightly **elevated** to peek above the midground.
- Use **fog** (`"weather": "foggy"`) to naturally fade far objects — this is free atmospheric depth.
- Spread objects across the full x range (−20 to +20) so the scene never feels like a single row.

### Elevation & height variation

**NEVER put every object at y=0.** Use elevation to break the flat-plane monotony:

| Terrain shape | `position.y` meaning | Typical `metadata.height` |
|---|---|---|
| `terrain/floor` | top surface = `y + 0.002` | Flat plane, no visible edges at any angle |
| `terrain/water` | animated water surface at this y | — (use `metadata.width/depth`) |
| `terrain/hill` | **ground elevation at the base of the dome** (use `y=0` for flat ground). Dome peak ≈ `y + metadata.height` | 5–45 units |
| `terrain/cliff` | **top edge** of the rock face. Cliff base sits at `y - metadata.height` (ground). | 5–12 units |
| `terrain/platform` | **top surface** where objects stand | 1–5 units |

**CRITICAL: never place `npc`, `building`, or `tree` objects at the same position as a `terrain/water` object — they will stand on the water surface. Always place them on solid terrain (`floor`, `hill`, `platform`) away from the water area.**

**CRITICAL: never make `terrain/floor` large enough to cover the `terrain/water` footprint — the water will be invisible. The floor must cover only the village/activity area; the lake/river must be positioned in a non-overlapping area (different z range). See the lakeside village example below.**

**Rule: any object sitting ON elevated terrain uses the same `y` as the terrain's `position.y`.**

```
terrain/platform at y=3 → buildings on the platform: y=3
terrain/cliff at y=8    → (cliff walls have nothing on top in most cases)
terrain/hill at y=0, height=7 → hill has no flat top; place NPCs/trees around the base at y=0
```

### Terrain shape catalog

| shape | Visual result | Good for |
|---|---|---|
| `floor` | Flat slab (custom `metadata.width/depth`) | Main ground, plazas, fields |
| `water` | Animated reflective water surface | Rivers, lakes, ocean, pools |
| `hill` | Rounded green dome (width/height configurable) | Rolling countryside, island mound |
| `cliff` | Tall grey rock face (width/height/depth) | Mountainside, canyon wall, sea cliff |
| `platform` | Raised flat slab (width/height/depth) | Elevated ruins, fortress battlements |
| `wall` | Interior room wall | INDOOR only |
| `ceiling` | Interior room ceiling | INDOOR only |
| `court` | Basketball/sports court | Sports scenes |

**Metadata fields for new terrain shapes:**
- `metadata.width` — footprint width (x, default 10–12)
- `metadata.height` — vertical extent / peak height (default 4–8)
- `metadata.depth` — footprint depth (z, default 10–12)

### Example: layered mountain valley scene

```json
[
  { "objectId": "t_ground",    "type": "terrain", "position": {"x":0,"y":0,"z":0},
    "metadata": {"shape":"floor","width":40,"depth":40} },

  { "objectId": "t_hill_l",    "type": "terrain", "position": {"x":-12,"y":0,"z":-18},
    "metadata": {"shape":"hill","width":14,"height":7} },
  { "objectId": "t_hill_r",    "type": "terrain", "position": {"x":14,"y":0,"z":-20},
    "metadata": {"shape":"hill","width":10,"height":5} },

  { "objectId": "t_cliff",     "type": "terrain", "position": {"x":0,"y":8,"z":-22},
    "metadata": {"shape":"cliff","width":30,"height":10,"depth":4} },

  { "objectId": "t_platform",  "type": "terrain", "position": {"x":6,"y":3,"z":-6},
    "metadata": {"shape":"platform","width":8,"height":2,"depth":8} },

  { "objectId": "tree_hilltop","type": "tree",    "position": {"x":-12,"y":7,"z":-18} },
  { "objectId": "building_mid","type": "building","position": {"x":6,"y":3,"z":-6} },
  { "objectId": "npc_fg",      "type": "npc",     "position": {"x":2,"y":0,"z":8} }
]
```

### Example: lakeside village scene (CRITICAL layout rules)

**WRONG — floor covers the lake (water will be invisible):**
```
floor at x=0, z=0, width=60, depth=60   ← covers EVERYTHING including where the lake is
water at x=0, z=-10, width=24, depth=18 ← buried under the floor
```

**CORRECT — floor covers only the village; lake is separate, outside the floor footprint:**
```json
[
  { "objectId": "t_village_ground", "type": "terrain", "position": {"x":4,"y":0,"z":8},
    "metadata": {"shape":"floor","width":28,"depth":20} },

  { "objectId": "t_lake", "type": "terrain", "position": {"x":0,"y":-0.1,"z":-8},
    "metadata": {"shape":"water","width":30,"depth":20} },

  { "objectId": "t_hill_l", "type": "terrain", "position": {"x":-14,"y":5,"z":-20},
    "metadata": {"shape":"hill","width":14,"height":6} },

  { "objectId": "npc_fisherman", "type": "npc", "position": {"x":-2,"y":0,"z":3},
    "description": "老渔民坐在湖岸边垂钓" },

  { "objectId": "bld_1", "type": "building", "position": {"x":5,"y":0,"z":10} }
]
```

**Key rules for lake-village layouts:**
- Make the `floor` cover **only** the village area (where buildings/NPCs actually stand)
- Position the `water` **outside and adjacent to** the floor footprint — not under it
- Water and floor should be in **different z ranges** (e.g., floor at z=5–15, water at z=-15 to -5)
- NPCs walk **beside** the lake (on the floor side), not on top of the water

### Viewpoint rules for immersive depth

- **Eye-level shot** (y≈1.7): place at z=+12–18, look toward midground — feels like standing in the scene
- **Elevated panorama** (y=8–15): place above a hill, look down at 30–45° — reveals the full terrain
- **Dramatic low angle** (y=0.5–1): z=+5, look up at cliff or building — exaggerates scale
- Always set `lookAt` to the focal point of the scene, never `{x:0,y:0,z:0}` blindly

---

## `position.y` rules (full table)

| Object | `position.y` | Notes |
|---|---|---|
| `terrain/floor` | `0` (or desired surface elevation) | Top surface at y+0.002 (PlaneGeometry, no visible sides) |
| `terrain/water` | desired **water level** (e.g. `0`, `-1`) | Animated reflective surface at this y |
| `terrain/hill` | desired **base ground elevation** (use `0` for flat terrain) | Dome rises from this base; peak ≈ y + metadata.height |
| `terrain/cliff` | desired **top edge** height (e.g. `8`) | Rock face descends below |
| `terrain/platform` | desired **top surface** height (e.g. `3`) | Slab hangs below this level |
| `terrain/wall` | half wall height (e.g. `1.6`) | INDOOR only |
| `terrain/ceiling` | room height (e.g. `3.2`) | INDOOR only |
| `object/*` furniture | **surface y it stands on** (e.g. `0` on floor, `3` on platform) | Renderer builds upward |
| `npc` | **surface y it stands on** | Feet placed at this y |
| `tree` | **surface y it stands on** | Trunk starts at this y |
| `building` | **surface y it stands on** | Builds upward from this y |

---

## Blackboard text

Put the exact text to display in the `description` field (e.g. `"黑板上写着'数学分析'"`). The renderer extracts and renders it automatically.

## General rules

- Include **exactly 2–3 viewpoints** suited to the scene.
- Make names and descriptions vivid and specific to the theme.
- `interactable: true` for `npc`, `item`, and interactive objects; `false` for floor/wall/ceiling/hill/cliff terrain.
- All `objectId` values must be unique strings (e.g. `"obj_gate"`, `"obj_fountain"`).
- All `viewpointId` values must be unique strings (e.g. `"vp_entrance"`, `"vp_overview"`).

---

## NPC Behavior Metadata

NPCs support movement modes and chatter bubbles via `metadata`:

```json
{
  "objectId": "npc_merchant",
  "type": "npc",
  "position": { "x": 3, "y": 0, "z": 0 },
  "interactable": true,
  "metadata": {
    "moveMode": "randomwalk",
    "speed": 0.8,
    "maxRadius": 4,
    "waypoints": [{"x": 2, "z": 3}, {"x": -2, "z": 1}],
    "chatter": ["今天生意不错", "你是外地人？", "小心山里的野狼"]
  }
}
```

**Movement mode fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `moveMode` | `"idle" \| "randomwalk" \| "patrol"` | `"idle"` | `"idle"` = bob/sway in place; `"randomwalk"` = wander randomly within `maxRadius`; `"patrol"` = loop through `waypoints` |
| `speed` | number | `0.8` | Movement speed in units/sec |
| `maxRadius` | number | `3.0` | Max wander radius for `randomwalk` mode |
| `waypoints` | `Array<{x, z}>` | `[]` | Ordered patrol points for `patrol` mode (y is inferred from NPC position) |

**Chatter field:**

| Field | Type | Default | Description |
|---|---|---|---|
| `chatter` | `string[]` | `[]` | Lines shown as speech bubbles when the NPC is clicked. A random line is chosen each click. Bubbles auto-hide after 3.5 s |

- `patrol` mode requires at least one entry in `waypoints`; without waypoints it falls back to pausing indefinitely.
- NPCs always perform idle bob/sway animation while paused or in `"idle"` mode.
- Clicking an NPC with no `chatter` array (or an empty one) silently does nothing.

---

## GLTF Model Loading (Path A)

Any object can load a real 3D model by setting `metadata.modelUrl` to a GLTF/GLB URL. The viewer will show a placeholder shape while loading, then replace it with the real model.

```json
{
  "objectId": "obj_duck",
  "name": "Yellow rubber duck",
  "type": "item",
  "position": { "x": 0, "y": 0, "z": 0 },
  "description": "A cheerful rubber duck",
  "interactable": true,
  "metadata": {
    "modelUrl": "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/Duck/glTF/Duck.gltf",
    "scale": 0.01,
    "yOffset": 0
  }
}
```

**Free asset sources:**
- **Kenney.nl** (kenney.nl/assets) — game-ready assets, CC0 license
- **Quaternius** (quaternius.com) — animated characters and props, CC0 license
- **KhronosGroup glTF Sample Assets** — `https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/`
  - Duck, DamagedHelmet, Avocado, CesiumMilkTruck, FlightHelmet, etc.
- **Three.js examples** — `https://threejs.org/examples/models/`

**Metadata fields for GLTF:**
- `modelUrl` (string) — URL to the `.gltf` or `.glb` file
- `scale` (number, default 1) — uniform scale applied to the loaded model
- `yOffset` (number, default 0) — vertical offset to correct ground alignment

---

## Gaussian Splat Rendering (Path D: splatUrl)

Set `sceneData.splatUrl` to load and display a pre-captured Gaussian splat file in the browser. The viewer will use a dedicated WebGL-based `SplatViewer` component powered by [spark.js](https://github.com/sparkjsdev/spark) instead of the standard Three.js renderer.

**Supported formats:** `.spz`, `.ply`, `.splat`, `.ksplat`

```json
{
  "sceneData": {
    "splatUrl": "https://example.com/scene.spz",
    "objects": [],
    "environment": {},
    "viewpoints": [
      {
        "viewpointId": "vp_default",
        "name": "Default view",
        "position": { "x": 0, "y": 0, "z": 3 },
        "lookAt": { "x": 0, "y": 0, "z": 0 }
      }
    ]
  }
}
```

**When to use:**
- Displaying photogrammetry captures or NeRF-derived Gaussian splats
- Showcasing real-world environments captured with 3D scanning tools
- High-fidelity photorealistic scenes that cannot be reproduced with procedural geometry

**Notes:**
- `objects` and `sceneCode` are ignored when `splatUrl` is set — the splat is the entire scene
- Camera auto-fits to the splat bounding box on load
- WASD keyboard navigation and mouse orbit/zoom work as usual
- The `viewpoints` array is still accepted but the camera auto-fit overrides the first viewpoint on initial load

**Free splat asset sources:**
- [Luma AI](https://lumalabs.ai) — capture and export as .spz
- [Polycam](https://poly.cam) — export Gaussian splats from room scans
- [sparkjsdev/spark assets](https://sparkjs.dev) — demo .spz files for testing

---



Set `environment.effects.bloom` to enable glow on emissive materials:

```json
{
  "environment": {
    "skybox": "night",
    "effects": {
      "bloom": {
        "strength": 1.2,
        "radius": 0.4,
        "threshold": 0.9
      }
    }
  }
}
```

**When to use bloom:**
- Night scenes with neon lights, glowing windows, streetlamps
- Sci-fi scenes with emissive panels, energy beams
- Sunset scenes with strong light halos
- Default bloom is always active (subtle: strength=0.4, threshold=0.9)
- Night skybox auto-boosts bloom strength to 0.8 minimum
- **threshold minimum is 0.9** — never set lower; values below 0.9 cause ordinary lit surfaces to bloom and wash out the scene

---

## Code Generation Mode (Path C)

**WARNING: Use `sceneCode` ONLY when the scene genuinely requires it. Most scenes should use JSON mode.**

Use `sceneCode` ONLY for:
- Particle systems (fountains, fire, snow, smoke)
- Continuous per-frame animations (rotating objects, wave effects, morphing geometry)
- Custom shaders or procedural geometry that cannot be expressed as static objects
- Complex terrain with vertex-color heightmaps or displacement maps

Do NOT use `sceneCode` for:
- **Any static scene** (classroom, office, park, street, shop — use JSON `objects` array)
- **Indoor scenes** (rooms, halls, labs) — always JSON mode
- **Simple outdoor scenes** (parks, streets, sports fields, villages) — use JSON mode with hill/cliff/platform terrain shapes
- Tile/grid floor patterns — use a single `terrain/floor` object instead
- Adding more detail to walls, ceilings, or furniture — JSON shapes handle this

**Use `sceneCode` for natural landscapes** (mountain ranges, canyons, coastlines, volcanic terrain, arctic tundra):
- These require **procedural heightmap terrain** — simple `terrain/hill` sphere/cone shapes cannot produce realistic topography
- Use multi-octave FBM + ridge noise for organic mountain silhouettes
- Use vertex colors (elevation + slope) for natural snow/rock/scree coloring
- Create a single large `PlaneGeometry` with high subdivisions rather than stacking individual hill objects

If a scene has NPCs, furniture, buildings, or terrain but **no moving/animated elements**, use pure JSON mode (`sceneData` only, no `sceneCode`).

For scenes requiring complex animations, custom shaders, or visual effects beyond the JSON schema, pass `sceneCode` alongside `sceneData`.

The `sceneCode` is a JavaScript function body that receives the full rendering context:

```
Sandbox variables available:
  - THREE      — the Three.js library (all classes, constants, etc.)
  - scene      — THREE.Scene (add your objects here)
  - camera     — THREE.PerspectiveCamera
  - renderer   — THREE.WebGLRenderer
  - controls   — OrbitControls
  - animate    — function(cb: (delta: number) => void) — register a per-frame callback
  - Water      — THREE.js Water addon (three/addons/objects/Water.js)
                 Use for realistic reflective ocean/lake surfaces.
                 Requires a waterNormals texture loaded via THREE.TextureLoader.
                 Normal map CDN: https://threejs.org/examples/textures/waternormals.jpg
```

### Water addon usage pattern

```javascript
const waterGeometry = new THREE.PlaneGeometry(200, 200);
const water = new Water(waterGeometry, {
  textureWidth: 512,
  textureHeight: 512,
  waterNormals: new THREE.TextureLoader().load(
    'https://threejs.org/examples/textures/waternormals.jpg',
    (tex) => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
  ),
  sunDirection: new THREE.Vector3(0.5, 1, 0.5).normalize(),
  sunColor: 0xffffff,
  waterColor: 0x001e0f,
  distortionScale: 3.7,
  fog: false,
});
water.rotation.x = -Math.PI / 2;
water.position.y = 0.0;
scene.add(water);

// Update water time uniform each frame
animate((delta) => {
  water.material.uniforms['time'].value += delta;
});
```

**Example: Procedural mountain terrain (use this pattern for snow mountains, canyons, highland scenes)**

```javascript
// Multi-octave FBM + ridge noise terrain — realistic alpine mountain range
function hash(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function smoothNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix+1, iy), c = hash(ix, iy+1), d = hash(ix+1, iy+1);
  return a*(1-ux)*(1-uy) + b*ux*(1-uy) + c*(1-ux)*uy + d*ux*uy;
}
function fbm(x, y, octaves) {
  let v = 0, amp = 0.5, freq = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    v += amp * smoothNoise(x * freq, y * freq); total += amp; amp *= 0.5; freq *= 2.1;
  }
  return v / total;
}
function ridgeNoise(x, y, octaves) {
  let v = 0, amp = 0.5, freq = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    const n = Math.abs(smoothNoise(x * freq, y * freq) - 0.5) * 2;
    v += amp * (1 - n); total += amp; amp *= 0.55; freq *= 2.0;
  }
  return v / total;
}

const W = 220, D = 180;
const geo = new THREE.PlaneGeometry(W, D, 180, 150);
geo.rotateX(-Math.PI / 2);
const pos = geo.attributes.position;
const colors = new Float32Array(pos.count * 3);

// Peak definitions: [worldX, worldZ, height, radiusX, radiusZ]
const peaks = [
  [0, -50, 55, 28, 32], [-32, -58, 40, 22, 26], [35, -55, 36, 20, 24],
  [-68, -75, 30, 32, 38], [72, -72, 28, 30, 36], [8, -80, 38, 35, 40],
];
const snowC = new THREE.Color(0xeff2f5), rockC = new THREE.Color(0x5a5248),
      baseC = new THREE.Color(0x3a3230), cx = new THREE.Color();

for (let i = 0; i < pos.count; i++) {
  const wx = pos.getX(i), wz = pos.getZ(i);
  let h = fbm(wx * 0.012, wz * 0.012, 4) * 3;
  for (const [px, pz, ph, rx, rz] of peaks) {
    const dist2 = ((wx-px)/rx)**2 + ((wz-pz)/rz)**2;
    if (dist2 > 2.5) continue;
    const ridge = ridgeNoise(wx * 0.035 + px * 0.01, wz * 0.035 + pz * 0.01, 5);
    const t = Math.max(0, 1 - dist2 / 2.25);
    const falloff = t*t*t*(t*(6*t-15)+10);
    h += ph * ridge * falloff;
  }
  h += fbm(wx * 0.18, wz * 0.18, 3) * 1.2;
  pos.setY(i, h);
  const tSnow = Math.min(1, Math.max(0, (h - 16) / 12));
  const tRock = Math.min(1, Math.max(0, (h - 6) / 8));
  cx.lerpColors(baseC, rockC, tRock);
  cx.lerpColors(cx, snowC, tSnow);
  colors[i*3] = cx.r; colors[i*3+1] = cx.g; colors[i*3+2] = cx.b;
}

pos.needsUpdate = true;
geo.computeVertexNormals();
geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
terrain.receiveShadow = true; terrain.castShadow = true;
scene.add(terrain);

// Snow valley floor
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(220, 70).rotateX(-Math.PI/2),
  new THREE.MeshStandardMaterial({ color: 0xdde8f0, roughness: 0.95 })
);
ground.position.set(0, 0.05, 45); ground.receiveShadow = true; scene.add(ground);

scene.fog = new THREE.FogExp2(0xb8cce0, 0.004);
```

**Key parameters to adjust per scene:**
- `W × D` — terrain footprint (220×180 = large mountain range)
- `peaks[]` array — add/remove/reposition peaks with custom height and influence radius
- Snow line: `(h - 16) / 12` — lower `16` to start snow earlier; set to `8` for all-white alpine
- `scene.fog` density: `0.004` light haze; `0.008` heavy clouds; `0.0` no fog

**Example: Animated particle system**

**Example: Falling snow (add to any mountain/winter scene)**

```javascript
// Falling snow — 80 particles, precomputed randoms, animate() loop
const N = 80;
const snowPos = new Float32Array(N * 3);
const vy = new Float32Array(N), dx = new Float32Array(N), dz = new Float32Array(N);
for (let i = 0; i < N; i++) {
  snowPos[i*3]   = (Math.random() - 0.5) * 120;  // x spread (match scene width)
  snowPos[i*3+1] = Math.random() * 50;            // initial y (0..50)
  snowPos[i*3+2] = (Math.random() - 0.5) * 120;  // z spread
  vy[i] = 1.5 + Math.random() * 2.5;             // fall speed (units/sec)
  dx[i] = (Math.random() - 0.5) * 0.6;           // horizontal drift x
  dz[i] = (Math.random() - 0.5) * 0.4;           // horizontal drift z
}
const snowGeo = new THREE.BufferGeometry();
const attr = new THREE.BufferAttribute(snowPos, 3);
attr.setUsage(THREE.DynamicDrawUsage);
snowGeo.setAttribute('position', attr);
scene.add(new THREE.Points(snowGeo,
  new THREE.PointsMaterial({ color: 0xeef4ff, size: 0.35, transparent: true, opacity: 0.82, depthWrite: false })
));
animate((delta) => {
  const p = snowGeo.attributes.position;
  for (let i = 0; i < N; i++) {
    p.setY(i, p.getY(i) - vy[i] * delta);
    p.setX(i, p.getX(i) + dx[i] * delta);
    p.setZ(i, p.getZ(i) + dz[i] * delta);
    if (p.getY(i) < -1) { p.setY(i, 48 + Math.random() * 8); }
  }
  p.needsUpdate = true;
});
// Tune: N ≤ 100 (perf limit) | size 0.2–0.5 | spread matches scene floor width
```

**Example: Falling rain**

```javascript
// Falling rain — 90 streaks rendered as thin vertical points
const N = 90;
const rainPos = new Float32Array(N * 3);
const vy = new Float32Array(N), dx = new Float32Array(N);
for (let i = 0; i < N; i++) {
  rainPos[i*3]   = (Math.random() - 0.5) * 80;
  rainPos[i*3+1] = Math.random() * 40;
  rainPos[i*3+2] = (Math.random() - 0.5) * 80;
  vy[i] = 18 + Math.random() * 10;   // rain falls fast
  dx[i] = (Math.random() - 0.5) * 1.5; // slight wind angle
}
const rainGeo = new THREE.BufferGeometry();
const rAttr = new THREE.BufferAttribute(rainPos, 3);
rAttr.setUsage(THREE.DynamicDrawUsage);
rainGeo.setAttribute('position', rAttr);
scene.add(new THREE.Points(rainGeo,
  new THREE.PointsMaterial({ color: 0x8ab4cc, size: 0.12, transparent: true, opacity: 0.55, depthWrite: false })
));
animate((delta) => {
  const p = rainGeo.attributes.position;
  for (let i = 0; i < N; i++) {
    p.setY(i, p.getY(i) - vy[i] * delta);
    p.setX(i, p.getX(i) + dx[i] * delta);
    if (p.getY(i) < 0) { p.setY(i, 38 + Math.random() * 6); }
  }
  p.needsUpdate = true;
});
// Tune: vy 18–28 for heavy rain, 8–14 for drizzle | color 0x8ab4cc (grey-blue)
```

Pass `sceneCode` in your tool call (alongside a minimal `sceneData` with viewpoints):

```javascript
// Sci-fi particle vortex
const geometry = new THREE.BufferGeometry();
const count = 3000;
const positions = new Float32Array(count * 3);
for (let i = 0; i < count; i++) {
  const r = 5 + Math.random() * 10;
  const theta = Math.random() * Math.PI * 2;
  const phi = (Math.random() - 0.5) * Math.PI;
  positions[i * 3]     = r * Math.cos(theta) * Math.cos(phi);
  positions[i * 3 + 1] = r * Math.sin(phi) * 3;
  positions[i * 3 + 2] = r * Math.sin(theta) * Math.cos(phi);
}
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const material = new THREE.PointsMaterial({ color: 0x00ffff, size: 0.08, transparent: true, opacity: 0.8 });
const particles = new THREE.Points(geometry, material);
scene.add(particles);

animate((delta) => {
  particles.rotation.y += delta * 0.3;
  particles.rotation.x += delta * 0.05;
});
```

**When to use Code Mode vs JSON Mode:**
- **JSON Mode** (default): simple scenes, furniture, buildings, NPCs, nature — use `sceneData`
- **Code Mode**: particle systems, procedural animations, custom shaders, morphing geometry, physics — use `sceneCode`
- Code mode is sandboxed — no network calls, no DOM manipulation, only Three.js API

## Performance Rules for Code Mode (CRITICAL)

Violating these causes severe lag or dropped frames:

- **Max particles per system: 100** — use `BufferGeometry` + `Points`; never exceed 100 points per system
- **Max total geometries: 30** — count every `new THREE.Mesh(...)` call; keep total ≤ 30
- **Never call `Math.random()` inside `animate()`** — precompute random values in arrays before the loop
- **Never reassign `geometry.attributes.position.array` inside `animate()`** — update in-place and set `needsUpdate = true` only when necessary; prefer shader-driven animation
- **Max `animate()` registrations: 3** — each call registers one per-frame callback; keep it minimal
- **Never use `scene.traverse()` with loose color filters to collect animated meshes** — broad color checks (e.g. `color.r > 0.8`) accidentally match walls, floors, and structural geometry alongside intended targets (flames, lights), causing the entire scene to shake or pulse. Always tag meshes explicitly: `mesh.userData.animated = true` before adding to the scene, then collect with `scene.traverse(obj => { if (obj.userData.animated) ... })`.
- **No `castShadow = true` on particle systems** — only set shadow casting on ≤ 5 static meshes

## Lighting Rules for Code Mode (CRITICAL)

When `sceneCode` is present, the renderer **mutes its built-in lights** and hands full lighting control to your code. You must supply all lighting yourself.

- **Always add at least one ambient or hemisphere light** — without it the scene will be pitch black
- **Total light intensity budget**: `AmbientLight ≤ 0.6` + `DirectionalLight ≤ 1.2` + point lights with falloff distance ≤ 20
- **Max PointLights: 6** — each point light multiplies render cost; use emissive materials for decorative glow instead
- **Never exceed emissiveIntensity > 1.5** on any material — high emissive values combined with bloom threshold cause severe overexposure
- **Do NOT set `castShadow = true` on DirectionalLight in sceneCode** — the renderer's shadow-casting sun is already muted; adding a new shadow light doubles GPU cost

## Text Rendering in Code Mode (CRITICAL)

**NEVER construct text by assembling geometric primitives (boxes, planes as strokes).** This produces unrecognizable shapes, especially for CJK (Chinese/Japanese/Korean) characters.

**ALWAYS use `CanvasTexture` for any text content.** The browser's font renderer handles all scripts correctly.

### Correct pattern: text on a surface

```javascript
// Create canvas and draw text
const canvas = document.createElement('canvas');
canvas.width = 1024;
canvas.height = 256;
const ctx = canvas.getContext('2d');

// Background
ctx.fillStyle = '#163a25';
ctx.fillRect(0, 0, canvas.width, canvas.height);

// Text — browser renders CJK correctly
ctx.fillStyle = '#f0ece4';
ctx.font = 'bold 180px serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('振兴中华', canvas.width / 2, canvas.height / 2);

// Apply as texture — flipY:true (default) corrects vertical axis
const texture = new THREE.CanvasTexture(canvas);

// Attach to a PlaneGeometry facing the camera (+z by default)
const mesh = new THREE.Mesh(
  new THREE.PlaneGeometry(8.7, 1.4),
  new THREE.MeshStandardMaterial({ map: texture, roughness: 0.88 }),
);
mesh.position.set(0, 2.15, -5.87);
scene.add(mesh);
```

### UV orientation rules (prevents mirroring)

| Plane rotation | Camera side | Text mirrored? | Fix |
|---|---|---|---|
| None (default, faces +z) | +z side | No | None needed |
| `rotation.y = Math.PI` (faces −z) | −z side | **Yes, horizontally** | `ctx.scale(-1, 1); ctx.translate(-width, 0)` before drawing |
| `rotation.x = -Math.PI/2` (floor) | above | No | None needed |

When in doubt, use default orientation (no rotation) and position the camera on the +z side.

### Multiple lines / styled text

```javascript
ctx.font = 'bold 72px sans-serif';
ctx.fillStyle = '#ffffff';
const lines = ['Line one', 'Line two'];
lines.forEach((line, i) => {
  ctx.fillText(line, canvas.width / 2, 80 + i * 90);
});
```

