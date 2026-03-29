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
| `"outdoor_riverside"` | River as central axis + valley floor (default 60×80 m) | river town, waterfront village, 湘西 ancient town |
| `"outdoor_hillside"` | Sloped ground rising front-to-back + terraces (default 60×50×20 m) | terraced farmland, mountain village, vineyard |

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

If none of the 8 scene types match, you may use raw coordinates. But you MUST manually apply every rule from the Spatial Logic section — especially rule 8 (terrain outside structures). Using `stdlib.useLayout()` is always preferred.

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
