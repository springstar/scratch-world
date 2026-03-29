## Sandbox Variables

```
THREE     — entire Three.js library (WebGPU build)
tsl       — Three.js Shading Language (TSL) — for custom node materials
scene     — THREE.Scene  (add objects here)
camera    — THREE.PerspectiveCamera (eye level = y 1.7 in walk mode)
renderer  — THREE.WebGPURenderer
controls  — OrbitControls (inactive when user enters walk mode)
animate   — function(cb: (delta: number) => void) — register a per-frame callback
stdlib    — Scene Standard Library (see 04-stdlib-api.md)
```

---

## Settlement Rendering

When `create_city` returns layout data, call `create_scene` immediately and write the sceneCode yourself. The layout gives exact building positions; the user's original prompt drives every atmospheric choice.

### Two-stage contract

```
create_city  →  layout (building positions, bounds, theme, roads)
                sceneData (interaction objects — pass verbatim to create_scene)
     ↓
YOU write sceneCode that:
  1. Calls stdlib.setupLighting() with atmosphere-appropriate params
  2. Lays down ground + perimeter trees/hills (see bounds)
  3. Renders every building from layout.buildings[]
  4. Adds roads if desired (use layout.roads counts as a guide)
  5. Adds NPCs — count and mood MUST match the prompt
  6. Sets camera at street level inside the settlement
```

### Prompt → atmosphere mapping

| Prompt signals | Lighting | Fog | NPCs | Style hints |
|---|---|---|---|---|
| quiet / serene / peaceful | dusk or dawn HDRI | light `FogExp2(0xc8b09a, 0.018)` | 1–2, idle | muted warm tones |
| busy / bustling / lively | noon clear_day | none | 4–6, randomwalk | bright saturated colors |
| mysterious / haunted / dark | sunset or night | heavy `FogExp2(0x1a1a2e, 0.04)` | 0–1 | desaturated, point lights |
| fantasy / magical | sunset HDRI | light purple fog | 3–4 | colored point lights, glow |
| abandoned / ruined | overcast | heavy `FogExp2(0x9a9a8a, 0.03)` | 0 | desaturated, grey |
| modern | clear_day no HDRI | none | 3–5 | concrete/glass colors |

### Rendering pattern

```javascript
// 1. Atmosphere (driven by prompt — do NOT default to clear_day noon for every scene)
stdlib.setupLighting({ skybox: "sunset", hdri: true });
scene.fog = new THREE.FogExp2(0xc8a87a, 0.014); // tune colour to match sky

// 2. Ground
stdlib.makeTerrain("floor", {
  width: layout.ground.width, depth: layout.ground.depth,
  position: { x: layout.bounds.cx, y: 0, z: layout.bounds.cz }
});

// 3. Perimeter trees
const pad = 6;
const angles = [0, 0.63, 1.26, 1.88, 2.51, Math.PI, 3.77, 4.40, 5.03, 5.65];
const rx = (layout.bounds.maxX - layout.bounds.minX) / 2 + pad;
const rz = (layout.bounds.maxZ - layout.bounds.minZ) / 2 + pad;
angles.forEach((a, i) => {
  stdlib.makeTree({ position: {
    x: layout.bounds.cx + Math.cos(a) * rx * (1 + (i % 3) * 0.10),
    y: 0,
    z: layout.bounds.cz + Math.sin(a) * rz * (1 + (i % 3) * 0.10)
  }});
});

// 4. Buildings
const COLORS = { tower: 0x888888, shop: 0xc8a87e, house: 0xd4bfa0, cottage: 0xa08060 };
for (const b of layout.buildings) {
  stdlib.makeBuilding({
    width: b.w, depth: b.d,
    height: b.type === "tower" ? 10 : b.type === "shop" ? 4 : b.type === "house" ? 5 : 3,
    style: b.type,
    color: COLORS[b.type] ?? 0x8b7355,
    position: { x: b.x, y: 0, z: b.z },
    rotationY: b.rotY,
  });
}

// 5. NPCs
stdlib.makeNpc({ position: { x: layout.bounds.cx + 2, y: 0, z: layout.bounds.cz }, moveMode: "idle" });

// 6. Camera
camera.position.set(layout.bounds.cx, 1.7, layout.bounds.maxZ + 12);
controls.target.set(layout.bounds.cx, 1, layout.bounds.cz);
```

---

## Viewpoints

Always set `sceneData.viewpoints` in the tool call — the camera starts at the first viewpoint.

```json
"viewpoints": [
  {
    "viewpointId": "vp_main",
    "name": "Main view",
    "position": { "x": 0, "y": 1.7, "z": 16 },
    "lookAt":   { "x": 0, "y": 1,   "z": 0  }
  },
  {
    "viewpointId": "vp_aerial",
    "name": "Aerial",
    "position": { "x": 0, "y": 20, "z": 20 },
    "lookAt":   { "x": 0, "y": 0,  "z": 0  }
  }
]
```

Typical viewpoint positions:
- Eye-level outdoor: `y=1.7, z=14–20` looking toward `{x:0, y:1, z:0}`
- Aerial panorama: `y=15–25, z=20` looking toward `{x:0, y:2, z:0}`
- Interior: `y=1.5, z=5–8` inside the room looking inward

---

## Scene Objects (metadata for interactions)

`sceneData.objects` carries NPC metadata for the interaction system. The renderer does **not** render these — `sceneCode` builds all visuals.

```json
"objects": [
  {
    "objectId": "npc_guard",
    "name": "老卫兵",
    "type": "npc",
    "position": { "x": 2, "y": 0, "z": 0 },
    "interactable": true,
    "interactionHint": "与他交谈",
    "metadata": {
      "character": "你是皇城门口驻守三十年的老卫兵，说话简短有力，知道城内各处禁忌。"
    }
  }
]
```

---

## Gaussian Splat Scenes (splatUrl)

When `sceneData.splatUrl` is set, the viewer renders a Gaussian splat instead of executing `sceneCode`.

```json
{
  "sceneData": {
    "splatUrl": "https://example.com/scene.spz",
    "objects": [],
    "viewpoints": [{ "viewpointId": "vp_1", "name": "Default", "position": { "x": 0, "y": 0, "z": 3 }, "lookAt": { "x": 0, "y": 0, "z": 0 } }]
  }
}
```

---

## Placing Objects at the Player's Position

When the user message starts with `[玩家当前位置: x=..., y=..., z=...]`:

```javascript
// Message: [玩家当前位置: x=3.2, y=0.8, z=-5.1] 在这里放一个木箱
const box = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  stdlib.makeMat(0x8b6040, 0.9, 0),
);
box.position.set(3.2, 0.8 + 0.5, -5.1);  // +0.5 to sit on the ground
box.castShadow = true;
scene.add(box);
```

---

## Performance Rules (CRITICAL)

- **NEVER use `Object.assign(mesh, opts)` or `mesh.position = v`** — always use `.set()` / `.copy()`:
  ```javascript
  mesh.position.set(x, y, z);
  mesh.position.copy(vector);
  mesh.rotation.set(rx, ry, rz);
  mesh.scale.setScalar(s);
  ```
- **Max particles: 100** — use `BufferGeometry` + `Points`
- **Max total meshes: 30** — count every `new THREE.Mesh(...)`
- **Never call `Math.random()` inside `animate()`** — precompute before the loop
- **Max `animate()` calls: 3**
- **No `castShadow = true` on particles** — only on ≤ 5 static meshes
- **NEVER set `castShadow = true` on SpotLights, PointLights, or floodlights** — causes shadow-map flickering and black screen on Apple Silicon. The stdlib directional sun is the only light allowed to cast shadows.
- **Hills, terrain, and trees are outside structures** — never place `makeTerrain("hill")` or tree inside a stadium perimeter, room, or any existing structure.

---

## Text Rendering (CRITICAL)

Never assemble text from geometric primitives. Always use `stdlib.makeCanvasTexture()` or raw `CanvasTexture`.

```javascript
const tex = stdlib.makeCanvasTexture("振兴中华", {
  bg: "#163a25", fg: "#f0ece4",
  font: "bold 80px serif",
  w: 512, h: 128,
});
const plane = new THREE.Mesh(
  new THREE.PlaneGeometry(4, 1),
  new THREE.MeshStandardMaterial({ map: tex }),
);
plane.position.set(0, 2, -5);
scene.add(plane);
```

---

## Pre-Submit Checklist

Answer every question before finalizing `sceneCode`. If any answer is "no", fix it first.

**Spatial skeleton**
- [ ] Does every direction the camera can face show a surface (wall, ground, sky, tree line)? No exposed black void?
- [ ] Is the ground/floor mesh larger than the farthest visible object?
- [ ] For indoor scenes: are all 6 faces (floor, ceiling, 4 walls) present?
- [ ] Does the camera start inside the skeleton, at y = 1.7 (eye level)?

**Scale**
- [ ] Are humans/NPCs placed at y = 0 and exactly ~1.8 m tall?
- [ ] Is the room/court/field the correct real-world size? (Check the Scale Anchors table in 02-scene-arch.md)
- [ ] Do doors (if any) measure 2.1 m tall?

**Lighting**
- [ ] Is `stdlib.setupLighting()` the very first call?
- [ ] For outdoor: does it include `hdri: true`?
- [ ] For indoor: does it include `isIndoor: true`?
- [ ] Are ALL extra lights (lamps, floodlights, spots, candles) set to `castShadow = false`?
- [ ] Does any terrain/hill/tree end up inside a building or stadium perimeter?

**Layer completeness**
- [ ] Layer 1 (sky/ceiling): present?
- [ ] Layer 2 (ground/floor): present and large enough?
- [ ] Layer 3 (boundary): hills / tree line / walls block the horizon?
- [ ] Layer 4 (large structures): bleachers / trees / columns define the space?
- [ ] Layer 6 (focal object): is there a clear hero element the user looks at first?

**Object placement**
- [ ] Every mesh sits on a surface? (y = surface_y + half_height)
- [ ] No objects clipping into each other?
- [ ] No `Object.assign(mesh, ...)` or `mesh.position = ...` direct assignments?
- [ ] For humanoids/animals/vehicles: using `stdlib.loadModel()`, not BoxGeometry?
