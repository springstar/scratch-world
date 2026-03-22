# generator-claude

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
| `terrain/floor` | top surface = `y + 0.075` | — (flat tile, use `metadata.width/depth`) |
| `terrain/water` | animated water surface at this y | — (use `metadata.width/depth`) |
| `terrain/hill` | **peak of the dome** | 3–8 units |
| `terrain/cliff` | **top edge** of the rock face | 5–12 units |
| `terrain/platform` | **top surface** where objects stand | 1–5 units |

**CRITICAL: never place `npc`, `building`, or `tree` objects at the same position as a `terrain/water` object — they will stand on the water surface. Always place them on solid terrain (`floor`, `hill`, `platform`) away from the water area.**

**Rule: any object sitting ON elevated terrain uses the same `y` as the terrain's `position.y`.**

```
terrain/hill at y=4    → trees on the hilltop: y=4
terrain/platform at y=3 → buildings on the platform: y=3
terrain/cliff at y=8   → (cliff walls have nothing on top in most cases)
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

### Viewpoint rules for immersive depth

- **Eye-level shot** (y≈1.7): place at z=+12–18, look toward midground — feels like standing in the scene
- **Elevated panorama** (y=8–15): place above a hill, look down at 30–45° — reveals the full terrain
- **Dramatic low angle** (y=0.5–1): z=+5, look up at cliff or building — exaggerates scale
- Always set `lookAt` to the focal point of the scene, never `{x:0,y:0,z:0}` blindly

---

## `position.y` rules (full table)

| Object | `position.y` | Notes |
|---|---|---|
| `terrain/floor` | `0` (or desired surface elevation) | Top surface at y+0.075 |
| `terrain/water` | desired **water level** (e.g. `0`, `-1`) | Animated reflective surface at this y |
| `terrain/hill` | desired **peak height** (e.g. `4`) | Dome descends from this peak |
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

## Post-Processing Effects (Path B)

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
- **Outdoor scenes without animation** — use JSON mode with hill/cliff/platform terrain shapes
- Tile/grid floor patterns — use a single `terrain/floor` object instead
- Adding more detail to walls, ceilings, or furniture — JSON shapes handle this

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

**Example: Animated particle system**

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

