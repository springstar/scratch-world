# generator-claude

## Philosophy

Every `create_scene` or `update_scene` call **must** provide `sceneCode`. The renderer executes this JavaScript in a sandbox that has full Three.js access plus a `stdlib` helper object.

**MANDATORY: Read the Scene Architecture section before writing any code.** Every scene must have a complete spatial skeleton, correct real-world scale, and be assembled in layer order. These are not optional — they are what separates a coherent scene from a floating box in a void.

**MANDATORY model rule**: You MUST call `stdlib.loadModel(url)` for any humanoid, animal, vehicle, or named prop. Building characters from BoxGeometry primitives is prohibited — it always looks terrible and there are free GLTF models available for everything. See the Asset Catalog below.

**Always start every scene with** `stdlib.setupLighting(...)`. Without it the scene is pitch black because the renderer's built-in lights are muted for `sceneCode` scenes.

**HDRI rule**: Always pass `hdri: true` for outdoor scenes. This loads a Polyhaven photographic sky that dramatically improves lighting quality at no rendering cost.

---

## Scene Architecture (READ BEFORE WRITING ANY CODE)

Visual coherence comes from following the same spatial logic that exists in the real world. Every scene must satisfy all three requirements below before adding any props or characters.

---

### Requirement 1 — Every scene needs a complete spatial skeleton

A spatial skeleton is the set of surfaces that enclose the viewer. Without it, rotating the camera reveals black void, which instantly destroys immersion.

| Scene type | Mandatory skeleton elements |
|---|---|
| **Indoor** (room, gym, arena, shop) | Floor + 4 walls + ceiling |
| **Outdoor open** (park, field, plaza) | Ground plane extending 60–100 m + sky (HDRI or SkyMesh) + distant boundary (hills, tree line, or building row) blocking the horizon on all sides |
| **Outdoor street** (road, alley, market) | Road surface + buildings on both sides creating a corridor + sky overhead |
| **Elevated** (rooftop, hilltop) | Surface platform + open sky + distant cityscape/landscape at a lower elevation |

**Building the skeleton is step 1. Never place props before the skeleton is complete.**

---

### Requirement 2 — Real-world scale anchors (MEMORIZE)

Wrong scale is the single most common reason a scene looks "game-like". Always match these real dimensions:

```
== HUMANS & DOORS ==
Human standing:        1.8 m tall
Door opening:          2.1 m tall × 0.9 m wide
Single-story ceiling:  2.6–3.2 m
Arena / gym ceiling:   8–14 m

== SPORTS ==
NBA court:             28 m × 15 m, basket at 3.05 m
Soccer field:          100 m × 68 m, crossbar at 2.44 m
Tennis court:          23.8 m × 10.97 m, net at 0.914 m
Swimming pool lane:    50 m × 2.5 m per lane

== FURNITURE ==
Table / desk surface:  0.75 m
Chair seat:            0.45 m
Bed (top surface):     0.55 m
Bookshelf:             0.3 m deep × 1.8 m tall

== URBAN ==
Car:                   1.5 m tall × 4.5 m long
Street lamp:           6 m
Building floor height: 3.5–4 m (add per floor)
Standard door frame:   2.1 m

== NATURE ==
Mature tree:           8–15 m tall
Shrub / bush:          1–1.5 m
Hill (visible bump):   8–15 m
Cliff:                 20–50 m
```

**Do not guess. If unsure, look up the real dimensions.**

---

### Requirement 3 — Layered composition (build in this order)

Every scene must be assembled bottom-up in exactly these layers. Skipping a layer produces floating objects and spatial incoherence.

```
Layer 1 — SKY / CEILING    → Must fill 100% of overhead view. No black patches.
Layer 2 — GROUND / FLOOR   → Must extend to the edge of the visible frustum.
Layer 3 — BOUNDARY         → Walls / tree line / buildings — blocks void at the perimeter.
Layer 4 — LARGE STRUCTURES → Bleachers, pillars, stands, large trees. Defines the space.
Layer 5 — PROPS            → Furniture, equipment, parked vehicles. Fills the space.
Layer 6 — FOCAL OBJECT     → The hero object or NPC the user looks at first.
```

Code structure should match this order: first `setupLighting`, then ground, then walls/boundary, then structures, then props, then NPCs/focal.

---

### Spatial logic rules (violations make scenes look fake)

1. **Nothing floats without explanation.** Every object must rest on a surface (y = surface_y + half_height) unless it is explicitly magical, flying, or suspended.
2. **Camera starts inside the scene.** The first viewpoint must be enclosed by the skeleton. Never start outside a building looking at a box.
3. **Indoor lighting lives inside.** Point lights and spot lights must be positioned inside the ceiling/walls, not outside the enclosure.
4. **Doors and openings face inward.** A door on a north wall opens toward south (into the room).
5. **One dominant light source.** One sun/key light casts all shadows. Additional lights (lamps, windows, floodlights) only add fill — `castShadow: false` on ALL of them, no exceptions. A floodlight with `castShadow: true` will cause severe shadow-map flickering artifacts when the camera moves, and on Apple Silicon will likely cause a black screen.
6. **Ground extends to horizon.** The ground/floor mesh must be wider than the farthest object the camera can see. For outdoor scenes: at least 100 m. For indoor: at least room-width + 2 m margin.
7. **Background fills all camera angles.** Rotate mentally 360° from the starting viewpoint — no direction should reveal black sky or clipping geometry.
8. **Terrain and vegetation stay far outside structures.** Hills and trees must never overlap or intersect any stadium/arena/building. The world z-axis: camera is at +Z, looking toward −Z. For a stadium whose back wall is at `z = -D`, hills go at `z < -(D + 30)` minimum — at least 30 m beyond the back wall. Placing a hill at e.g. `z = -20` when the stadium wall is at `z = -22` puts the hill visually INSIDE the stadium. Rule: `hill_z < stadium_back_wall_z − 30`.

   For a standard football stadium (field 100×68, perimeter wall at roughly `z = ±60`): hills go at `z < -90`. Never guess — always calculate from your own wall positions.

---

## Semantic Layout — use this for ALL new scenes

**Never hardcode x, y, z positions for structural elements.** Call `stdlib.useLayout(type)` first. The solver computes all spatial coordinates from canonical scene dimensions. You cannot get hills inside stadiums if you use the layout solver.

### Quick start

```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });
const L = stdlib.useLayout("outdoor_soccer");   // ← declare scene type
L.buildBase();                                   // ← builds ground + boundary + background
const goalPos = L.place("north_goal");           // ← get correct position for a role
// now build the goal at goalPos.position, rotated goalPos.rotationY
const vp = L.viewpoint();                        // ← safe camera position
camera.position.set(vp.position.x, vp.position.y, vp.position.z);
controls.target.set(vp.lookAt.x, vp.lookAt.y, vp.lookAt.z);
```

### Scene types

| Type | Description | Suitable for |
|---|---|---|
| `"indoor_room"` | 4 walls + ceiling (default 6×8×2.8 m) | bedroom, office, shop, lab |
| `"indoor_arena"` | Court + bleachers + ceiling (default NBA 28×15×10 m) | basketball, volleyball, boxing |
| `"outdoor_soccer"` | Soccer pitch + goals + boundary (default 100×68 m) | football, soccer |
| `"outdoor_basketball"` | Basketball court + hoops (default 28×15 m) | streetball, park court |
| `"outdoor_open"` | Large open ground + tree perimeter (default 80×80 m) | park, garden, plaza, festival |
| `"outdoor_street"` | Road corridor + building rows (default 10×80 m) | street, alley, market |

Override dimensions with the second argument:
```javascript
const L = stdlib.useLayout("indoor_room", { width: 10, depth: 14, height: 3.5 });
const L = stdlib.useLayout("outdoor_soccer", { width: 68, depth: 105 }); // custom field size
```

### Layout methods

```
L.dims                    → { width, depth, height, structureMinZ, structureMaxZ, ... }
L.buildBase()             → builds complete spatial skeleton (call once, after setupLighting)
L.buildGround()           → ground / floor surface only
L.buildWalls()            → 4 walls (indoor types only)
L.buildCeiling()          → ceiling plane (indoor types only)
L.buildBoundary()         → perimeter trees / buildings / stands
L.buildBackground()       → hills (always outside structureBounds + 30 m margin)
L.place(role)             → returns { position, rotationY } — use to position your object
L.viewpoint(name?)        → returns { position, lookAt } for camera setup
```

### Available roles per scene type

**`indoor_room`**: `desk`, `bed`, `bookshelf`, `window_north`, `window_south`, `door_south`, `ceiling_light`

**`indoor_arena`**: `hoop_north`, `hoop_south`, `bleachers_west`, `bleachers_east`, `center_court`, `scoreboard_north`, `scoreboard_south`, `light_nw`, `light_ne`, `light_sw`, `light_se`

**`outdoor_soccer`**: `north_goal`, `south_goal`, `center_circle`, `corner_nw`, `corner_ne`, `corner_sw`, `corner_se`, `penalty_north`, `penalty_south`, `bleachers_west`, `bleachers_east`

**`outdoor_basketball`**: `hoop_north`, `hoop_south`, `bench_west`, `bench_east`

**`outdoor_open`**: `center`, `bench_north`, `bench_south`, `bench_west`, `bench_east`, `fountain`, `lamp_nw`, `lamp_ne`, `lamp_sw`, `lamp_se`

**`outdoor_street`**: `lamp_left_near`, `lamp_left_mid`, `lamp_left_far`, `lamp_right_near`, `lamp_right_mid`, `lamp_right_far`

### Viewpoint names

All types: `"default"` (alias: omit arg) — inside scene at eye level
`indoor_arena`, sports types: `"sideline"`, `"end_zone"`, `"overview"`
`outdoor_open`: `"overview"`
`outdoor_street`: `"overview"`

### Complete scene examples

#### Indoor basketball arena

```javascript
stdlib.setupLighting({ isIndoor: true });
scene.fog = null;

const L = stdlib.useLayout("indoor_arena");
L.buildBase();

// Overhead lights (no castShadow — only the sun may cast shadows)
const lp = L.place("light_ne");
const light = new THREE.PointLight(0xfff5e0, 3, 24);
light.position.set(lp.position.x, lp.position.y, lp.position.z);
light.castShadow = false;
scene.add(light);

// Camera
const vp = L.viewpoint("end_zone");
camera.position.set(vp.position.x, vp.position.y, vp.position.z);
controls.target.set(vp.lookAt.x, vp.lookAt.y, vp.lookAt.z);
```

#### Indoor room / bedroom

```javascript
stdlib.setupLighting({ isIndoor: true });
scene.fog = null;

const L = stdlib.useLayout("indoor_room", { width: 6, depth: 8, height: 2.8 });
L.buildBase();

// Ceiling light
const clp = L.place("ceiling_light");
const clight = new THREE.PointLight(0xfff8f0, 2.5, L.dims.depth * 3);
clight.position.set(clp.position.x, clp.position.y, clp.position.z);
clight.castShadow = false;
scene.add(clight);

// Add furniture at solver-computed positions
const deskPos = L.place("desk");
// build desk mesh at deskPos.position ...

const vp = L.viewpoint();
camera.position.set(vp.position.x, vp.position.y, vp.position.z);
controls.target.set(vp.lookAt.x, vp.lookAt.y, vp.lookAt.z);
```

#### Outdoor soccer field

```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });

const L = stdlib.useLayout("outdoor_soccer");
L.buildBase();  // ground + grass + boundary trees + hills outside field

// Goals
const ng = L.place("north_goal");
// build goal mesh at ng.position, rotated ng.rotationY ...

// Camera at sideline
const vp = L.viewpoint("sideline");
camera.position.set(vp.position.x, vp.position.y, vp.position.z);
controls.target.set(vp.lookAt.x, vp.lookAt.y, vp.lookAt.z);
```

#### Outdoor open park

```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });

const L = stdlib.useLayout("outdoor_open");
L.buildBase();  // large ground + tree perimeter + distant hills

// Scatter NPCs around the park center
for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI * 2;
  stdlib.makeNpc({
    position: { x: Math.cos(angle) * 12, y: 0, z: Math.sin(angle) * 12 },
    moveMode: "randomwalk",
  });
}

const vp = L.viewpoint();
camera.position.set(vp.position.x, vp.position.y, vp.position.z);
controls.target.set(vp.lookAt.x, vp.lookAt.y, vp.lookAt.z);
```

---

### Advanced: custom layout (only when no matching scene type exists)

If none of the 6 scene types match, you may use raw coordinates. But you MUST manually apply every rule from the Spatial Logic section — especially rule 8 (terrain outside structures). Using `stdlib.useLayout()` is always preferred.

<details>
<summary>Old raw-coordinate templates (reference only)</summary>

#### Indoor arena (raw)

```javascript
stdlib.setupLighting({ isIndoor: true });
scene.fog = null;
const CW = 14, CD = 8, CH = 10;
const floor = stdlib.makeTerrain("court", { width: CW*2+8, depth: CD*2+8 });
scene.add(floor);
const wallMat = stdlib.makeMat(0xddd5c8, 0.9, 0);
[[0, CH/2, -(CD+4), CW*2+8, CH, 0.3],[0, CH/2, (CD+4), CW*2+8, CH, 0.3],
 [-(CW+4), CH/2, 0, 0.3, CH, CD*2+8],[(CW+4), CH/2, 0, 0.3, CH, CD*2+8]
].forEach(([x,y,z,w,h,d]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), wallMat);
  m.position.set(x,y,z); m.receiveShadow = true; scene.add(m);
});
camera.position.set(0, 1.7, CD + 2); camera.lookAt(0, 3, 0);
```

#### Outdoor open space (raw)

```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });
const ground = stdlib.makeTerrain("floor", { width: 120, depth: 120 });
scene.add(ground);
// Hills must be at least 30 m beyond any structure boundary
stdlib.makeTerrain("hill", { width: 40, height: 12, position: { x: -40, y: 0, z: -50 } });
stdlib.makeTerrain("hill", { width: 35, height:  9, position: { x:  35, y: 0, z: -45 } });
camera.position.set(0, 1.7, 15); camera.lookAt(0, 1, 0);
```

</details>

---

### Scene type skeletons (copy-paste starting points)

#### Indoor Sports Arena (basketball, volleyball, boxing)

```javascript
stdlib.setupLighting({ isIndoor: true });
scene.fog = null;

// Dimensions (NBA): court 28×15, ceiling 10m
const CW = 14, CD = 8, CH = 10;  // half-width, half-depth, ceiling height

// Floor — hardwood court texture
const floor = stdlib.makeTerrain("court", { width: CW*2+8, depth: CD*2+8 });
scene.add(floor);

// Walls (4 sides)
const wallMat = stdlib.makeMat(0xddd5c8, 0.9, 0);
[[0, CH/2, -(CD+4), CW*2+8, CH, 0.3],   // back wall
 [0, CH/2,  (CD+4), CW*2+8, CH, 0.3],   // front wall
 [-(CW+4), CH/2, 0, 0.3, CH, CD*2+8],   // left wall
 [ (CW+4), CH/2, 0, 0.3, CH, CD*2+8],   // right wall
].forEach(([x,y,z,w,h,d]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), wallMat);
  m.position.set(x,y,z); m.receiveShadow = true; scene.add(m);
});

// Ceiling
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(CW*2+8, CD*2+8), stdlib.makeMat(0x555555, 1, 0));
ceiling.rotation.x = Math.PI / 2;
ceiling.position.set(0, CH, 0);
scene.add(ceiling);

// Overhead lights (no shadows — texture slot budget)
[-6, 0, 6].forEach(x => {
  const light = new THREE.PointLight(0xfff5e0, 3, 20);
  light.position.set(x, CH - 0.5, 0);
  light.castShadow = false;
  scene.add(light);
});

// Camera: inside arena, near one end, eye level
camera.position.set(0, 1.7, CD + 2);
camera.lookAt(0, 3, 0);
```

#### Indoor Room / Office / Shop

```javascript
stdlib.setupLighting({ isIndoor: true });
scene.fog = null;

const W = 6, D = 8, H = 2.8; // room half-width, half-depth, height

const floorMat = stdlib.makeMat(0xc8a46e, 0.8, 0);
const wallMat  = stdlib.makeMat(0xf0ece4, 0.9, 0);
const ceilMat  = stdlib.makeMat(0xffffff, 1.0, 0);

// Floor
const fl = new THREE.Mesh(new THREE.PlaneGeometry(W*2, D*2), floorMat);
fl.rotation.x = -Math.PI/2; fl.receiveShadow = true; scene.add(fl);

// Ceiling
const ce = new THREE.Mesh(new THREE.PlaneGeometry(W*2, D*2), ceilMat);
ce.rotation.x = Math.PI/2; ce.position.y = H; scene.add(ce);

// Walls
const walls = [
  { pos: [0, H/2, -D], size: [W*2, H, 0.15] }, // back
  { pos: [0, H/2,  D], size: [W*2, H, 0.15] }, // front (behind camera)
  { pos: [-W, H/2, 0], size: [0.15, H, D*2] }, // left
  { pos: [ W, H/2, 0], size: [0.15, H, D*2] }, // right
];
walls.forEach(({ pos, size }) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), wallMat);
  m.position.set(...pos); m.receiveShadow = true; scene.add(m);
});

// Ceiling light
const clight = new THREE.PointLight(0xfff8f0, 2.5, D*3);
clight.position.set(0, H - 0.2, 0);
clight.castShadow = false;
scene.add(clight);

// Camera inside, eye level
camera.position.set(0, 1.7, D - 1);
camera.lookAt(0, 1.5, -D + 1);
```

#### Outdoor Open Space (park, field, plaza)

```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });

// Ground — must extend to horizon
const ground = stdlib.makeTerrain("floor", { width: 120, depth: 120 });
scene.add(ground);

// Perimeter boundary — no direction should reveal void
// Option A: hills on far sides
stdlib.makeTerrain("hill", { width: 40, height: 12, position: { x: -40, y: 0, z: -50 } });
stdlib.makeTerrain("hill", { width: 35, height:  9, position: { x:  35, y: 0, z: -45 } });
stdlib.makeTerrain("hill", { width: 30, height: 10, position: { x:  -5, y: 0, z: -55 } });

// Option B: tree line around perimeter
for (let i = 0; i < 16; i++) {
  const angle = (i / 16) * Math.PI * 2;
  stdlib.makeTree({ position: { x: Math.cos(angle) * 45, y: 0, z: Math.sin(angle) * 45 }, scale: 1.2 });
}

// Camera: eye level, inside the scene
camera.position.set(0, 1.7, 15);
camera.lookAt(0, 1, 0);
```

#### Outdoor Street / Urban Corridor

```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });

// Road surface
const road = stdlib.makeTerrain("floor", { width: 8, depth: 80, texture: "cobblestone_floor_01" });
scene.add(road);

// Sidewalk + buildings on both sides (create corridor — no void between buildings)
const STREET_HALF = 4; // half road width
[-1, 1].forEach(side => {
  // Sidewalk
  const walk = stdlib.makeTerrain("floor", {
    width: 3, depth: 80,
    position: { x: side * (STREET_HALF + 1.5), y: 0.08, z: 0 }
  });
  scene.add(walk);

  // Buildings — pack them tightly, no gaps
  for (let z = -35; z < 40; z += 8 + Math.floor(stdlib.seed(z, side) * 4)) {
    stdlib.makeBuilding({
      width: 7, depth: 8,
      height: 8 + stdlib.seed(z*1.3, side) * 12,
      position: { x: side * (STREET_HALF + 7), y: 0, z }
    });
  }
});

camera.position.set(0, 1.7, 18);
camera.lookAt(0, 2, -10);
```

---

## Sandbox Variables

```
THREE     — entire Three.js library (WebGPU build)
tsl       — Three.js Shading Language (TSL) — for custom node materials
scene     — THREE.Scene  (add objects here)
camera    — THREE.PerspectiveCamera (eye level = y 1.7 in walk mode)
renderer  — THREE.WebGPURenderer
controls  — OrbitControls (inactive when user enters walk mode)
animate   — function(cb: (delta: number) => void) — register a per-frame callback
WaterMesh — WaterMesh from three/addons (animated reflective water)
stdlib    — Scene Standard Library (see below)
```

---

## stdlib API Reference

### `stdlib.setupLighting(opts?)`

Sets up scene lighting, fog, sky background, and optional Polyhaven HDRI env map.

```typescript
stdlib.setupLighting(opts?: {
  skybox?:    "clear_day" | "sunset" | "night" | "overcast";
  timeOfDay?: "dawn" | "noon" | "dusk" | "night";
  isIndoor?:  boolean;  // default false — pushes fog far away for enclosed spaces
  hdri?:      boolean;  // default true — async loads Polyhaven 1k HDRI for IBL
})
```

**Always call this first.** It adds `HemisphereLight` + `DirectionalLight` (4096 shadow map) and sets fog.

```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });
```

### `stdlib.loadModel(url, opts?)` → `Promise<THREE.Group>`

Loads a GLTF/GLB model and adds it to the scene. This is the primary way to add quality geometry.

```typescript
stdlib.loadModel(url: string, opts?: {
  position?: { x: number; y: number; z: number };
  scale?:    number;
  rotation?: { x?: number; y?: number; z?: number };
  castShadow?:    boolean;  // default true
  receiveShadow?: boolean;  // default true
}): Promise<THREE.Group>
```

```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });

// Load an animated soldier character
stdlib.loadModel("https://threejs.org/examples/models/gltf/Soldier.glb", {
  position: { x: 0, y: 0, z: 0 },
  scale: 1,
});
```

### `stdlib.makeNpc(opts)` → `Promise<THREE.Group>`

Creates an NPC with optional GLTF character model and movement/animation.

```typescript
stdlib.makeNpc(opts: {
  position:   { x: number; y: number; z: number };
  modelUrl?:  string;   // GLTF URL — if set, loads real animated character
  idleClip?:  string;   // animation clip name for idle (default: first clip)
  walkClip?:  string;   // animation clip name for walking
  name?:      string;
  moveMode?:  "idle" | "randomwalk" | "patrol";  // default "idle"
  speed?:     number;   // units/sec, default 0.8
  maxRadius?: number;   // randomwalk radius, default 3
  waypoints?: Array<{ x: number; z: number }>;   // patrol path
  chatter?:   string[]; // speech bubble lines on click
}): Promise<THREE.Group>
```

When `modelUrl` is set, loads the GLTF and plays the animation. Without `modelUrl`, falls back to a simple procedural humanoid shape.

```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });

// Real animated character
stdlib.makeNpc({
  position: { x: 2, y: 0, z: 0 },
  modelUrl: "https://threejs.org/examples/models/gltf/Soldier.glb",
  idleClip: "Idle",
  walkClip: "Walk",
  moveMode: "randomwalk",
  maxRadius: 5,
  chatter: ["Hello!", "Nice day today."],
});
```

### `stdlib.makeTerrain(shape, opts?)`

Creates terrain geometry with PBR textures where applicable.

```typescript
stdlib.makeTerrain(
  shape: "floor" | "hill" | "cliff" | "platform" | "water" | "wall" | "court",
  opts?: {
    width?:    number;
    depth?:    number;
    height?:   number;
    texture?:  string;   // Polyhaven texture ID
    color?:    number;   // fallback color hex
    position?: { x: number; y: number; z: number };
  }
): THREE.Object3D
```

```javascript
stdlib.setupLighting({ skybox: "clear_day" });

// Grassy floor
const ground = stdlib.makeTerrain("floor", { width: 80, depth: 80, position: { x: 0, y: 0, z: 0 } });

// Hill in the background
const hill = stdlib.makeTerrain("hill", { width: 16, height: 8, position: { x: -12, y: 0, z: -20 } });

// Animated water lake
const lake = stdlib.makeTerrain("water", { width: 30, depth: 20, position: { x: 8, y: 0, z: -10 } });
```

### `stdlib.makeBuilding(opts?)` → `THREE.LOD`

Creates a building with 3-level LOD. Registered for hysteresis update automatically.

```typescript
stdlib.makeBuilding(opts?: {
  width?:     number;  // default 6
  depth?:     number;  // default 6
  height?:    number;  // default 8
  color?:     number;
  position?:  { x: number; y: number; z: number };
  rotationY?: number;
}): THREE.LOD
```

```javascript
stdlib.setupLighting({ skybox: "clear_day" });

for (let i = 0; i < 6; i++) {
  stdlib.makeBuilding({
    position: { x: (i - 2.5) * 10, y: 0, z: -8 },
    height: 6 + Math.random() * 10,
    color: 0x8b7355,
  });
}
```

### `stdlib.makeTree(opts?)`

Creates a tree (trunk + foliage layers) with optional scale/color variation.

```typescript
stdlib.makeTree(opts?: {
  scale?:     number;
  colorSeed?: number;
  position?:  { x: number; y: number; z: number };
}): THREE.Group
```

### `stdlib.makeWater(width, depth, y?)` → `THREE.Group`

Creates animated WaterMesh surface with normal-map waves. Lower-level than `makeTerrain("water")`.

### `stdlib.makeMat(color, roughness?, metalness?)` → `THREE.MeshStandardMaterial`

```javascript
const mat = stdlib.makeMat(0x8b6040, 0.8, 0.0);
```

**Material recipes — always use these values. Never use roughness=0.5/metalness=0 defaults.**

| Surface | color (hex) | roughness | metalness | notes |
|---|---|---|---|---|
| Hardwood floor (light oak) | `0xc8a46e` | 0.45 | 0.0 | use `applyPbr` + repeat 12 for best result |
| Hardwood floor (dark walnut) | `0x6b4226` | 0.5 | 0.0 | |
| Concrete floor | `0x9e9e9e` | 0.85 | 0.0 | `applyPbr("concrete_floor_02", 8)` |
| Painted wall (white) | `0xf2efe8` | 0.92 | 0.0 | slight warm tint, not pure white |
| Painted wall (colored) | your choice | 0.88 | 0.0 | |
| Brick wall | `0xc1693a` | 0.9 | 0.0 | `applyPbr("red_brick_03", 6)` |
| Plaster / stucco | `0xddd5c8` | 0.95 | 0.0 | |
| Glass (window) | `0xadd8e6` | 0.05 | 0.0 | `transparent:true, opacity:0.25` |
| Polished marble | `0xe8e4de` | 0.1 | 0.0 | low roughness = visible reflections |
| Brushed steel | `0xb0b8c0` | 0.35 | 0.95 | |
| Rusted iron | `0x8b4513` | 0.85 | 0.6 | |
| Shiny chrome | `0xd4d4d4` | 0.05 | 1.0 | |
| Basketball court | `0xd4824a` | 0.6 | 0.0 | orange-tan wood |
| Grass (synthetic) | `0x3a7d44` | 0.95 | 0.0 | use `applyPbr("aerial_grass_rock", 30)` for real grass |
| Asphalt / road | `0x333333` | 0.95 | 0.0 | |
| Cobblestone | `0x7a7060` | 0.9 | 0.0 | `applyPbr("cobblestone_floor_01", 10)` |
| Sand | `0xe2c98a` | 0.98 | 0.0 | |
| Water (still) | `0x1a6fa8` | 0.05 | 0.0 | use `stdlib.makeWater()` instead |
| Fabric / cloth | `0x8b7355` | 0.98 | 0.0 | near-1 roughness, 0 metalness |
| Skin | `0xffcba4` | 0.7 | 0.0 | use GLTF model, not raw mesh |
| Emissive screen | `0x002244` | 1.0 | 0.0 | set `emissive` + `emissiveIntensity 1.5–3` |

```javascript
// Examples
const floor   = stdlib.makeMat(0xc8a46e, 0.45, 0.0);  // oak hardwood
const steel   = stdlib.makeMat(0xb0b8c0, 0.35, 0.95); // brushed steel
const glass   = new THREE.MeshStandardMaterial({ color: 0xadd8e6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.25 });
const marble  = stdlib.makeMat(0xe8e4de, 0.1,  0.0);  // polished marble
const screen  = new THREE.MeshStandardMaterial({ color: 0x002244, emissive: new THREE.Color(0x1155cc), emissiveIntensity: 2 });
```

### `stdlib.makeTerrainSlopeMat(topColor, sideColor, lo?, hi?)` → `THREE.MeshStandardNodeMaterial`

Slope-blended material for hills and cliffs (grass on top, rock on sides).

### `stdlib.makeMountainMat(snowColor?, rockColor?)` → `THREE.MeshStandardNodeMaterial`

Elevation-blended material (rock at base, snow at peak). Use with geometry whose local Y spans 0–1.

### `stdlib.applyPbr(mat, textureId, repeat, displacementScale?)`

Applies a Polyhaven PBR texture to a `MeshStandardMaterial`.

Common `textureId` values:
- `"aerial_grass_rock"` — grass/rock terrain
- `"cobblestone_floor_01"` — cobblestone
- `"red_brick_03"` — brick wall
- `"concrete_floor_02"` — smooth concrete

```javascript
const mat = stdlib.makeMat(0x4a7c59, 0.9, 0);
stdlib.applyPbr(mat, "aerial_grass_rock", 40);
```

### `stdlib.makeCanvasTexture(text, opts?)` → `THREE.CanvasTexture`

Creates a canvas-rendered text texture. Use for signs, labels, blackboards.

```typescript
stdlib.makeCanvasTexture(text: string, opts?: {
  bg?:   string;  // CSS color, default "#163a25"
  fg?:   string;  // CSS color, default "#f0ece4"
  font?: string;  // CSS font string
  w?:    number;  // canvas width, default 512
  h?:    number;  // canvas height, default 128
}): THREE.CanvasTexture
```

### `stdlib.colorFor(type)` → `number`

Returns a palette color for a given object type: `"building"`, `"terrain"`, `"tree"`, `"npc"`, `"item"`, `"object"`.

### `stdlib.seed(x, z)` → `number`

Deterministic pseudo-random 0–1 value keyed to (x, z) position. Use for stable per-object variation.

### `stdlib.invalidate()`

Signals the renderer to render the next frame. Call after async asset loads complete.

### `stdlib.addAmbientSound(url, volume?)` → AudioContext

Play a looping background sound. Uses the Web Audio API; the sound runs independently of the render loop.

```typescript
stdlib.addAmbientSound(url: string, volume?: number): AudioContext
// volume: 0–1 linear gain, default 0.4
```

**Free sound CDN URLs (CC0, CORS-accessible)**:

| Environment | URL |
|-------------|-----|
| Forest / outdoor | `https://cdn.freesound.org/previews/531/531947_11861866-lq.mp3` |
| Crowd / stadium | `https://cdn.freesound.org/previews/493/493925_1835877-lq.mp3` |
| Ocean waves | `https://cdn.freesound.org/previews/378/378895_4284968-lq.mp3` |
| Rain | `https://cdn.freesound.org/previews/346/346642_5121236-lq.mp3` |
| Fireplace / indoor | `https://cdn.freesound.org/previews/476/476178_9803805-lq.mp3` |

```javascript
// Add gentle outdoor ambience
stdlib.addAmbientSound("https://cdn.freesound.org/previews/531/531947_11861866-lq.mp3", 0.3);
```

Note: AudioContext requires a user gesture (click/keypress) to start on some browsers. Sound may be silently blocked until the user interacts with the page.

---

## Asset Catalog (Free CDNs)

**Use these URLs directly in `stdlib.loadModel()` or `stdlib.makeNpc()`. All verified working.**

CDN prefixes used below:
- `THR` = `https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/models/gltf`
- `KHR` = `https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models`
- `KNY` = `https://cdn.jsdelivr.net/gh/KenneyNL`

---

### Characters & NPCs (animated — use for ALL humans/animals)

| Model | URL | Clips | Scale |
|---|---|---|---|
| Soldier (rigged humanoid) | `THR/Soldier.glb` | `Idle` `Walk` `Run` | 1.0 |
| RobotExpressive (cartoon robot) | `THR/RobotExpressive/RobotExpressive.glb` | `Idle` `Walk` `Run` `Jump` `Wave` `ThumbsUp` `Death` | 1.0 |
| CesiumMan (male figure) | `KHR/CesiumMan/glTF-Binary/CesiumMan.glb` | walking | 1.0 |
| Fox | `KHR/Fox/glTF-Binary/Fox.glb` | `Walk` `Run` `Survey` | 0.02 |
| Horse | `THR/Horse.glb` | gallop | 1.0 |
| Flamingo | `THR/Flamingo.glb` | wing flap | 1.0 |
| Parrot | `THR/Parrot.glb` | wing flap | 1.0 |
| Stork | `THR/Stork.glb` | wing flap | 1.0 |

**Default for any human NPC**: use `Soldier.glb` at scale 1.0, y=0. For cartoon/robot style: `RobotExpressive.glb`.

---

### Vehicles

| Model | URL | Scale | Notes |
|---|---|---|---|
| Milk truck (animated wheels) | `KHR/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb` | 1.0 | ~4m long |
| Concept car (PBR) | `KHR/CarConcept/glTF-Binary/CarConcept.glb` | 1.0 | ~4.5m long |
| Toy car | `KHR/ToyCar/glTF-Binary/ToyCar.glb` | 30 | toy scale, high-quality PBR |
| Low-poly truck (green) | `KNY/Starter-Kit-Racing@master/models/vehicle-truck-green.glb` | 1.0 | MIT |

---

### Buildings & Urban Props (KenneyNL — MIT license, low-poly, game-ready)

| Model | URL | Scale |
|---|---|---|
| Small building A | `KNY/Starter-Kit-City-Builder@master/models/building-small-a.glb` | 1.0 |
| Small building B | `KNY/Starter-Kit-City-Builder@master/models/building-small-b.glb` | 1.0 |
| Small building C | `KNY/Starter-Kit-City-Builder@master/models/building-small-c.glb` | 1.0 |
| Garage | `KNY/Starter-Kit-City-Builder@master/models/building-garage.glb` | 1.0 |
| Road straight | `KNY/Starter-Kit-City-Builder@master/models/road-straight.glb` | 1.0 |
| Road corner | `KNY/Starter-Kit-City-Builder@master/models/road-corner.glb` | 1.0 |
| Road intersection | `KNY/Starter-Kit-City-Builder@master/models/road-intersection.glb` | 1.0 |
| Trees (cluster) | `KNY/Starter-Kit-City-Builder@master/models/grass-trees.glb` | 1.0 |
| Trees (tall cluster) | `KNY/Starter-Kit-City-Builder@master/models/grass-trees-tall.glb` | 1.0 |

---

### Furniture & Interior Props (KhronosGroup — CC0/CC-BY)

| Model | URL | Scale | Notes |
|---|---|---|---|
| Upholstered chair | `KHR/SheenChair/glTF-Binary/SheenChair.glb` | 1.0 | CC0 |
| Velvet sofa | `KHR/GlamVelvetSofa/glTF-Binary/GlamVelvetSofa.glb` | 1.0 | CC-BY |
| Wood/leather sofa | `KHR/SheenWoodLeatherSofa/glTF-Binary/SheenWoodLeatherSofa.glb` | 1.0 | CC-BY |
| Ornate chair | `KHR/ChairDamaskPurplegold/glTF-Binary/ChairDamaskPurplegold.glb` | 1.0 | CC-BY |
| Potted plant | `KHR/DiffuseTransmissionPlant/glTF-Binary/DiffuseTransmissionPlant.glb` | 1.0 | CC-BY |
| Glass vase with flowers | `KHR/GlassVaseFlowers/glTF-Binary/GlassVaseFlowers.glb` | 1.0 | CC0 |
| Sci-fi helmet (PBR showcase) | `KHR/DamagedHelmet/glTF-Binary/DamagedHelmet.glb` | 1.0 | CC-BY |

---

### Usage patterns

```javascript
// CDN prefix constants (copy into sceneCode)
const THR = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/models/gltf";
const KHR = "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models";
const KNY = "https://cdn.jsdelivr.net/gh/KenneyNL";

// Humanoid NPC with walk animation
stdlib.makeNpc({
  position: { x: 0, y: 0, z: 0 },
  modelUrl: `${THR}/Soldier.glb`,
  idleClip: "Idle", walkClip: "Walk",
  moveMode: "randomwalk", maxRadius: 5,
});

// City block: pack buildings along a street
for (let i = 0; i < 5; i++) {
  stdlib.loadModel(`${KNY}/Starter-Kit-City-Builder@master/models/building-small-${["a","b","c","a","b"][i]}.glb`, {
    position: { x: i * 9 - 18, y: 0, z: -12 },
    scale: 1.0,
  });
}

// Furnished room corner
stdlib.loadModel(`${KHR}/SheenChair/glTF-Binary/SheenChair.glb`, { position: { x: -2, y: 0, z: -3 } });
stdlib.loadModel(`${KHR}/GlassVaseFlowers/glTF-Binary/GlassVaseFlowers.glb`, { position: { x: -2.5, y: 0.75, z: -3.3 }, scale: 0.5 });

// Crowd of spectators
for (let i = 0; i < 20; i++) {
  const row = Math.floor(i / 5), col = i % 5;
  stdlib.makeNpc({
    position: { x: col * 2 - 4, y: row * 1.2 + 3, z: -16 - row * 0.8 },
    modelUrl: `${THR}/Soldier.glb`,
    idleClip: "Idle", moveMode: "idle",
  });
}
```

---

## Scene Templates

### Coordinate system (MEMORIZE before building any scene)

```
       +Y (up)
        |
        |_______ +X (right)
       /
      /
    +Z (toward camera)

Default camera: position (0, 8, 20), looking at origin (0, 0, 0).
The camera sees the scene from positive Z, looking toward negative Z.
```

**Consequence for sports courts**: A basketball/football court lying along the X-axis has its far goal at negative Z, near goal at positive Z. The camera (at z=20) looks inward. **Never place the near wall at z < 20 or the camera will be outside.**

### Indoor scene checklist (FOLLOW EVERY TIME `isIndoor: true`)

1. `stdlib.setupLighting({ isIndoor: true })` — auto-hides the world grass ground, sets dark background
2. Set `scene.fog = null` — fog at y=0 has no meaning inside a building
3. Position camera INSIDE the enclosure: `camera.position.set(x, 1.7, z_inside)` where `z_inside` is well inside the far wall
4. The enclosure must be large enough that the camera starts inside it
5. For arenas: walls at ±half-width in X and ±half-depth in Z; ceiling at top; no floor gap with world ground

### Basketball hoop geometry (correct orientation)

Court lies along X-axis. Baselines at `x = ±14`. Camera is at positive Z looking toward −Z.

```
BACKBOARD (faces +X inward, away from wall)
ARM (horizontal, from wall toward court)
POLE (at x = ±15.5, outside the baseline)

For left goal  (x = -14): pole at x=-15.5, arm extends right (+x), rim at x=-12.8
For right goal (x = +14): pole at x=+15.5, arm extends left  (-x), rim at x=+12.8

Rule: rim is INSIDE the baseline, pole is OUTSIDE the baseline.
```

```javascript
function addHoop(baselineX) {
  const inward = baselineX > 0 ? -1 : 1; // direction from baseline toward court center
  // Pole: outside the baseline
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.5, 8), metalMat);
  pole.position.set(baselineX - inward * 1.5, 1.75, 0); // OUTSIDE
  scene.add(pole);
  // Arm: horizontal beam extending inward from pole top
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), metalMat);
  arm.position.set(baselineX - inward * 0.9, 3.4, 0);
  scene.add(arm);
  // Backboard: faces inward (face normal = inward direction)
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 1.83), boardMat);
  board.position.set(baselineX - inward * 0.25, 3.35, 0);
  scene.add(board);
  // Rim: INSIDE the baseline
  const rimPts = Array.from({ length: 33 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * 0.23, 0, Math.sin(a) * 0.23);
  });
  const rim = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), 32, 0.022, 8, true),
    hoopMat
  );
  rim.position.set(baselineX + inward * 1.2, 3.05, 0); // INSIDE
  scene.add(rim);
}
addHoop(-14); // left goal
addHoop(14);  // right goal
```

### Outdoor landscape

```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });

// Ground
const ground = stdlib.makeTerrain("floor", { width: 100, depth: 100, position: { x: 0, y: 0, z: 0 } });

// Background hills
stdlib.makeTerrain("hill", { width: 20, height: 10, position: { x: -18, y: 0, z: -25 } });
stdlib.makeTerrain("hill", { width: 16, height:  7, position: { x:  14, y: 0, z: -22 } });

// Trees (foreground)
for (let i = 0; i < 8; i++) {
  const x = (stdlib.seed(i, 0) - 0.5) * 40;
  const z = stdlib.seed(0, i) * 15 - 5;
  stdlib.makeTree({ position: { x, y: 0, z }, scale: 0.8 + stdlib.seed(i, i) * 0.5 });
}

// Buildings
stdlib.makeBuilding({ position: { x: -6, y: 0, z: -5 }, height: 8 });
stdlib.makeBuilding({ position: { x:  4, y: 0, z: -7 }, height: 6 });

// NPC
stdlib.makeNpc({
  position: { x: 2, y: 0, z: 2 },
  modelUrl: "https://threejs.org/examples/models/gltf/Soldier.glb",
  idleClip: "Idle",
  moveMode: "randomwalk",
  maxRadius: 4,
});
```

### Indoor room

```javascript
stdlib.setupLighting({ isIndoor: true }); // auto: dark background, hides world ground
scene.fog = null;

// Place camera inside the room before building walls
camera.position.set(0, 1.7, 5);   // eye level, inside the near wall
camera.lookAt(0, 1.5, -3);

// Room geometry (4 walls + floor + ceiling)
const HALF_W = 6, HALF_D = 8, H = 3.2;
stdlib.makeTerrain("floor",   { width: HALF_W*2, depth: HALF_D*2, position: { x: 0, y: 0, z: 0 } });
stdlib.makeTerrain("ceiling", { width: HALF_W*2, depth: HALF_D*2, position: { x: 0, y: H, z: 0 } });
stdlib.makeTerrain("wall",    { width: HALF_W*2, height: H, position: { x:  0,      y: H/2, z: -HALF_D } }); // back
stdlib.makeTerrain("wall",    { width: HALF_W*2, height: H, position: { x:  0,      y: H/2, z:  HALF_D } }); // front
stdlib.makeTerrain("wall",    { width: HALF_D*2, height: H, position: { x: -HALF_W, y: H/2, z: 0 } }); // left
stdlib.makeTerrain("wall",    { width: HALF_D*2, height: H, position: { x:  HALF_W, y: H/2, z: 0 } }); // right

// Furniture (raw Three.js — or loadModel for quality)
const deskGeo = new THREE.BoxGeometry(2, 0.1, 0.8);
const deskMat = stdlib.makeMat(0xc8a46e, 0.8, 0);
const desk = new THREE.Mesh(deskGeo, deskMat);
desk.position.set(0, 0.8, -3);
desk.castShadow = true;
scene.add(desk);

// Sign using canvas texture
const tex = stdlib.makeCanvasTexture("欢迎光临", { bg: "#163a25", fg: "#f0ece4", font: "bold 64px serif" });
const sign = new THREE.Mesh(
  new THREE.PlaneGeometry(3, 0.75),
  new THREE.MeshStandardMaterial({ map: tex }),
);
sign.position.set(0, 2.5, -HALF_D + 0.05);
scene.add(sign);
```

### Animated particle scene

```javascript
stdlib.setupLighting({ skybox: "night", hdri: false });
scene.background = new THREE.Color(0x060818);

// Floating orbs
const N = 60;
const positions = new Float32Array(N * 3);
const velocities = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  positions[i*3]   = (Math.random() - 0.5) * 30;
  positions[i*3+1] = Math.random() * 15;
  positions[i*3+2] = (Math.random() - 0.5) * 30;
  velocities[i*3]   = (Math.random() - 0.5) * 0.4;
  velocities[i*3+1] = (Math.random() - 0.5) * 0.2;
  velocities[i*3+2] = (Math.random() - 0.5) * 0.4;
}
const geo = new THREE.BufferGeometry();
const attr = new THREE.BufferAttribute(positions, 3);
attr.setUsage(THREE.DynamicDrawUsage);
geo.setAttribute("position", attr);
scene.add(new THREE.Points(geo,
  new THREE.PointsMaterial({ color: 0x88ccff, size: 0.3, transparent: true, opacity: 0.8, depthWrite: false })
));

animate((delta) => {
  for (let i = 0; i < N; i++) {
    attr.setXYZ(i,
      attr.getX(i) + velocities[i*3]   * delta,
      attr.getY(i) + velocities[i*3+1] * delta,
      attr.getZ(i) + velocities[i*3+2] * delta,
    );
    if (Math.abs(attr.getX(i)) > 15) velocities[i*3]   *= -1;
    if (attr.getY(i) < 0 || attr.getY(i) > 15) velocities[i*3+1] *= -1;
    if (Math.abs(attr.getZ(i)) > 15) velocities[i*3+2] *= -1;
  }
  attr.needsUpdate = true;
});
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

`sceneData.objects` carries NPC metadata for the interaction system. The renderer does **not** render these objects — `sceneCode` builds all visuals. The objects array is used for:
- NPC character context (dialogue AI)
- `interactable` flags (click interaction prompt)
- `interactionHint` (text shown on hover)

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

When `sceneData.splatUrl` is set, the viewer renders a Gaussian splat instead of executing `sceneCode`. Use for photorealistic photogrammetry captures.

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

When the user message starts with `[玩家当前位置: x=..., y=..., z=...]`, the player has walked to the desired placement spot. In `sceneCode`, create the object at exactly those coordinates:

```
Message: [玩家当前位置: x=3.2, y=0.8, z=-5.1]
在这里放一个木箱
```

```javascript
// In sceneCode — use the player's coordinates directly
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

- **NEVER use `Object.assign(mesh, opts)` or direct assignment `mesh.position = v`** — Three.js `position`, `rotation`, `scale` are read-only getters that return Vector3/Euler objects. Direct assignment silently fails or throws. Always use:
  ```javascript
  mesh.position.set(x, y, z);          // NOT mesh.position = new THREE.Vector3(x,y,z)
  mesh.position.copy(vector);           // NOT Object.assign(mesh, { position: vector })
  mesh.rotation.set(rx, ry, rz);
  mesh.scale.setScalar(s);
  ```
- **Max particles: 100** — use `BufferGeometry` + `Points`
- **Max total meshes: 30** — count every `new THREE.Mesh(...)`
- **Never call `Math.random()` inside `animate()`** — precompute random values before the loop
- **Max `animate()` calls: 3**
- **No `castShadow = true` on particles** — only on ≤ 5 static meshes
- **NEVER set `castShadow = true` on SpotLights, PointLights, or floodlights** — this is the single most common cause of shadow-map flickering artifacts when the camera moves, and on Apple Silicon will likely cause a black screen. The stdlib directional sun is the only light allowed to cast shadows. Set `castShadow = false` on every other light, including stadium floodlights, street lamps, and candles.
- **Hills, terrain, and trees are outside structures** — never place a `makeTerrain("hill")` or tree inside a stadium perimeter, inside a room, or anywhere it would intersect or overlap an existing structure. Hills belong beyond the outer boundary wall as background fill. If the stadium boundary is at x=±50, hills go at z < -60 or beyond the far wall.

## Text Rendering (CRITICAL)

Never assemble text from geometric primitives. Always use `stdlib.makeCanvasTexture()` or raw `CanvasTexture` for any text (including CJK characters).

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
- [ ] Is the room/court/field the correct real-world size? (Check the Scale Anchors table)
- [ ] Do doors (if any) measure 2.1 m tall?

**Lighting**
- [ ] Is `stdlib.setupLighting()` the very first call?
- [ ] For outdoor: does it include `hdri: true`?
- [ ] For indoor: does it include `isIndoor: true`?
- [ ] Are ALL extra lights (lamps, floodlights, spots, candles) set to `castShadow = false`? Any shadow-casting extra light causes camera-movement flickering artifacts.
- [ ] Does any terrain/hill/tree end up inside a building or stadium perimeter? If yes, move it outside.

**Layer completeness**
- [ ] Layer 1 (sky/ceiling): present?
- [ ] Layer 2 (ground/floor): present and large enough?
- [ ] Layer 3 (boundary): hills / tree line / walls block the horizon?
- [ ] Layer 4 (large structures): bleachers / trees / columns define the space?
- [ ] Layer 6 (focal object): is there a clear hero element the user looks at first?

**Object placement**
- [ ] Every mesh sits on a surface? (y = surface_y + half_height)
- [ ] No objects clipping into each other?
- [ ] No `Object.assign(mesh, ...)` or `mesh.position = ...` direct assignments? (use `.position.set()`)
- [ ] For humanoids/animals/vehicles: using `stdlib.loadModel()`, not BoxGeometry?