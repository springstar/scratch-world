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
        "shape": "desk | chair | blackboard | window | door | wall | floor | shelf | box | pillar | hoop | court",
        "state": "current state string if stateful",
        "transitions": { "action verb": "next state" },
        "modelUrl": "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/Duck/glTF/Duck.gltf",
        "scale": 1.0,
        "yOffset": 0
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
  - Use type `"terrain"` for ground only. **Do NOT add walls or ceiling.**
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
- **Object positions**: spread across a 40×40 unit area (x and z from −20 to 20).
- **`position.y` rules** — CRITICAL, wrong y causes floating or sunken objects:

| Object | `position.y` | Reason |
|---|---|---|
| `terrain/floor` | `0` | Ground level |
| `terrain/wall` | half wall height (e.g. `1.6`) | Renderer uses y as wall center |
| `terrain/ceiling` | room height (e.g. `3.2`) | Renderer uses y directly |
| `object/*` furniture | `0` | Renderer builds upward from y=0 |
| `npc` | `0` | Feet placed at y=0 by renderer |
| `tree`, `building` | `0` | Built upward from y=0 |

- **Blackboard text**: put the exact text to display in the `description` field (e.g. `"黑板上写着'数学分析'"`). The renderer extracts and renders it automatically.
- Include **exactly 2–3 viewpoints** suited to the scene.
- Make names and descriptions vivid and specific to the theme.
- `interactable: true` for `npc`, `item`, and interactive objects; `false` for floor/wall/ceiling terrain.
- All `objectId` values must be unique strings (e.g. `"obj_gate"`, `"obj_fountain"`).
- All `viewpointId` values must be unique strings (e.g. `"vp_entrance"`, `"vp_overview"`).

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

## Code Generation Mode (Path C)

**WARNING: Use `sceneCode` ONLY when the scene genuinely requires it. Most scenes should use JSON mode.**

Use `sceneCode` ONLY for:
- Particle systems (fountains, fire, snow, smoke)
- Continuous per-frame animations (rotating objects, wave effects, morphing geometry)
- Custom shaders or procedural geometry that cannot be expressed as static objects

Do NOT use `sceneCode` for:
- **Any static scene** (classroom, office, park, street, shop — use JSON `objects` array)
- **Indoor scenes** (rooms, halls, labs) — always JSON mode
- **Outdoor scenes** without animation — always JSON mode
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

