## stdlib API Reference

### `stdlib.setupLighting(opts?)`

Sets up scene lighting, fog, sky background, and optional Polyhaven HDRI env map.

```typescript
stdlib.setupLighting(opts?: {
  skybox?:    "clear_day" | "sunset" | "night" | "overcast" | "dynamic_sky";
  timeOfDay?: "dawn" | "noon" | "dusk" | "night";
  isIndoor?:  boolean;  // default false — pushes fog far away for enclosed spaces
  hdri?:      boolean;  // default true — async loads Polyhaven 1k HDRI for IBL
  // dynamic_sky only:
  sunElevation?: number;  // degrees above horizon (0–90, default 45)
  sunAzimuth?:   number;  // degrees (0=south, 90=west, default 180)
})
```

**Always call this first.** It adds `HemisphereLight` + `DirectionalLight` (4096 shadow map) and sets fog.

**`dynamic_sky`** uses the Preetham atmospheric scattering model (SkyMesh) — physically accurate sky colour from sun position. Use for scenes where the sky is visible and time-of-day atmosphere matters.

```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });

// Dynamic sky — sun at 30° elevation, coming from the south-west
stdlib.setupLighting({ skybox: "dynamic_sky", sunElevation: 30, sunAzimuth: 220 });

// Dawn light — very low sun
stdlib.setupLighting({ skybox: "dynamic_sky", sunElevation: 8, sunAzimuth: 90 });
```

### `stdlib.loadModel(url, opts?)` → `Promise<THREE.Group>`

Loads a GLTF/GLB model and adds it to the scene. Primary way to add quality geometry.

```typescript
stdlib.loadModel(url: string, opts?: {
  position?: { x: number; y: number; z: number };
  scale?:    number;
  rotation?: { x?: number; y?: number; z?: number };
  castShadow?:    boolean;  // default true
  receiveShadow?: boolean;  // default true
  animationClip?: "first" | string;  // "first" plays the first clip; a string matches by name
}): Promise<THREE.Group>
```

```javascript
// Load animated soldier — play first clip automatically
stdlib.loadModel("https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb", {
  position: { x: 0, y: 0, z: 0 },
  scale: 1,
  animationClip: "first",
});
```

### `stdlib.placeAsset(id, opts?)` → `Promise<THREE.Group>`

Places a cataloged asset by semantic ID. Looks up the CDN URL and calibrated scale from the asset catalog automatically. **Prefer this over `loadModel` for cataloged assets** — no need to look up scale.

```typescript
stdlib.placeAsset(id: string, opts?: {
  position?: { x: number; y: number; z: number };
  scale?:    number;   // multiplier on top of catalog calibration (1 = catalog default)
  rotation?: { x?: number; y?: number; z?: number };
}): Promise<THREE.Group>
```

```javascript
stdlib.placeAsset("character_soldier", { position: { x: 2, y: 0, z: 0 } });
stdlib.placeAsset("prop_lantern", { position: { x: 0, y: 2.5, z: -3 } });
```

See `07-asset-catalog.md` for the full catalog of available IDs.

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

```javascript
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
const ground = stdlib.makeTerrain("floor", { width: 80, depth: 80, position: { x: 0, y: 0, z: 0 } });
const hill = stdlib.makeTerrain("hill", { width: 16, height: 8, position: { x: -12, y: 0, z: -20 } });
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

---

### `stdlib.makeRiver(opts?)` → `THREE.Group`  ⭐ USE FOR RIVERS, STREAMS, CANALS

Creates a river channel with animated water surface and muddy banks. The dominant anchor for any riverside scene.

```typescript
stdlib.makeRiver(opts?: {
  width?:      number;  // channel width in metres (default 18)
  length?:     number;  // length along Z axis (default 80)
  meander?:    number;  // 0=straight, 1=strong curve (default 0.3)
  waterY?:     number;  // y-level of water surface (default 0)
  bedDepth?:   number;  // riverbed depth below waterY (default 1.2)
  waterColor?: number;  // hex (default 0x2d5a6e — dark teal for 湘西/karst)
  position?:   Vec3;
})
```

```javascript
stdlib.makeRiver({ width: 22, length: 90, waterColor: 0x2d5a6e,
  position: { x: 0, y: 0, z: 0 } });
```

---

### `stdlib.makeKarstPeak(opts?)` → `THREE.Group`  ⭐ USE FOR SOUTH CHINA / VIETNAM / KARST LANDSCAPES

Creates a near-vertical limestone spire with concave-convex vertical sides (NOT a sphere or cone). Optional animated mist planes clinging to mid-peak.

```typescript
stdlib.makeKarstPeak(opts?: {
  height?:  number;  // total height in metres (default 60)
  radius?:  number;  // base radius in metres (default 20)
  color?:   number;  // rock color (default 0x6a7060 grey-green limestone)
  mist?:    boolean; // animated wisps at 30/50/65% height (default true)
  position?: Vec3;
})
```

```javascript
stdlib.makeKarstPeak({ height: 55, radius: 14, mist: true, position: { x: -28, y: 0, z: -55 } });
stdlib.makeKarstPeak({ height: 70, radius: 18, mist: true, position: { x:  32, y: 0, z: -62 } });
```

---

### `stdlib.makeTerracedSlope(opts?)` → `THREE.Group`  ⭐ USE FOR TERRACED FARMLAND, HILLSIDE VILLAGES

Creates stepped agricultural terraces with optional flooded paddy water layer.

```typescript
stdlib.makeTerracedSlope(opts?: {
  steps?:         number;  // terrace steps (default 5)
  totalHeight?:   number;  // total elevation rise in metres (default 16)
  width?:         number;  // slope face width in metres (default 40)
  terracesDepth?: number;  // horizontal depth per tread (default 6)
  floodedStep?:   number;  // which step (0-based) to flood with water (-1=none, default -1)
  topColor?:      number;  // tread surface color (default 0x4a6a30 wet paddy green)
  riserColor?:    number;  // vertical face color (default 0x7a5a30 earth brown)
  position?:      Vec3;
  rotationY?:     number;
})
```

```javascript
stdlib.makeTerracedSlope({ steps: 4, totalHeight: 12, width: 30,
  floodedStep: 1, position: { x: -22, y: 0, z: -20 } });
```

---

### `stdlib.makeGateway(opts?)` → `THREE.Group`  ⭐ USE FOR ARCHED MONUMENTS, TRIUMPHAL GATES

Creates an arched gateway structure using ExtrudeGeometry with a real arch opening. Use for Arc de Triomphe, Brandenburg Gate, torii gates, paifang, city gates.

**Never use `makeBuilding()` for a landmark with an arch — it produces a solid box with no opening.**

```typescript
stdlib.makeGateway(opts?: {
  height?:     number;  // total height (default 10)
  width?:      number;  // total width (default 14)
  depth?:      number;  // thickness along Z (default 3)
  archHeight?: number;  // arch crown height above ground (default 6, must be < height)
  archWidth?:  number;  // arch opening width (default 6, must be < width)
  color?:      number;  // default 0xd4c8a0 (limestone cream)
  position?:   Vec3;
  rotationY?:  number;
})
```

```javascript
// Arc de Triomphe proportions
stdlib.makeGateway({
  height: 50, width: 45, depth: 22,
  archHeight: 29, archWidth: 15,
  color: 0xede8d8,
  position: { x: 0, y: 0, z: -85 },
});
```

---

### Worked Example: 湘西古镇 (Xiangxi riverside village)

```javascript
// Pre-analysis:
//   1. Dominant anchor: river (fills center + bottom 40% of frame)
//   2. Terrain: steep+river valley
//   3. Cultural: 湘西 — warm brown timber, grey-green limestone, dark teal water, heavy mist
//   4. Layout: outdoor_riverside
//   5. Plan: river centered at origin, stilted houses on left bank,
//            karst peaks in background, terraced slope on hillside above left bank,
//            camera on right bank looking across to stilt houses through mist

stdlib.setupLighting({ skybox: "overcast", hdri: true });
scene.fog = new THREE.FogExp2(0x9ab0aa, 0.022); // grey-green mountain mist

const L = stdlib.useLayout("outdoor_riverside", { width: 60, depth: 80 });
L.buildBase(); // flat ground + river (18m wide) + lateral cliff walls

// Karst peaks — far background
stdlib.makeKarstPeak({ height: 55, radius: 14, mist: true,
  position: L.place("peak_left").position });
stdlib.makeKarstPeak({ height: 70, radius: 18, mist: true,
  position: L.place("peak_right").position });

// Terraced rice paddies on the hillside above left bank
stdlib.makeTerracedSlope({
  steps: 4, totalHeight: 12, width: 30, floodedStep: 1,
  position: { x: -24, y: 0, z: -18 },
});

// Camera — right bank, eye-level, looking across river to stilt houses
const vp = L.viewpoint("default");
camera.position.set(vp.position.x, vp.position.y, vp.position.z);
controls.target.set(vp.lookAt.x, vp.lookAt.y, vp.lookAt.z);
```

---

### `stdlib.makePhysicalMat(color, opts?)` → `THREE.MeshPhysicalMaterial`  ⭐ PREFER FOR KEY SURFACES

**Use instead of `makeMat` for any surface the camera looks at closely.**

```typescript
stdlib.makePhysicalMat(color: number, opts?: {
  roughness?:          number;
  metalness?:          number;
  clearcoat?:          number;  // 0–1: polished lacquer
  clearcoatRoughness?: number;  // default 0.1
  transmission?:       number;  // 0–1: glass-like transparency
  ior?:                number;  // glass=1.5, water=1.33, diamond=2.4
  thickness?:          number;  // transmission depth (default 0.5)
  anisotropy?:         number;  // 0–1: brushed-metal highlight
  iridescence?:        number;  // 0–1: oil-film spectral shift
})
```

**Physical material recipes — MANDATORY for these surface types:**

| Surface | recipe |
|---|---|
| **NBA/sports hardwood floor** | `makePhysicalMat(0xc07820, { roughness:0.35, clearcoat:0.85, clearcoatRoughness:0.08 })` then `applyPbr(mat, "wood_floor", 14)` |
| **Polished marble / tile** | `makePhysicalMat(0xe8e2d6, { roughness:0.08, clearcoat:1.0, clearcoatRoughness:0.05 })` then `applyPbr(mat, "marble_01", 6)` |
| **Glass panel / window** | `makePhysicalMat(0xc8e0f0, { roughness:0.04, transmission:0.96, ior:1.52, thickness:0.3 })` |
| **Lacquered wood (furniture)** | `makePhysicalMat(0x8b5e3c, { roughness:0.3, clearcoat:0.6, clearcoatRoughness:0.15 })` |
| **Brushed stainless steel** | `makePhysicalMat(0xb8bec4, { roughness:0.3, metalness:0.95, anisotropy:0.8 })` |
| **Polished chrome** | `makePhysicalMat(0xd0d4d8, { roughness:0.05, metalness:1.0 })` |
| **Ice / frosted glass** | `makePhysicalMat(0xd0e8f4, { roughness:0.15, transmission:0.7, ior:1.31, thickness:0.5 })` |

```javascript
// ✅ CORRECT — polished hardwood court floor
const floorMat = stdlib.makePhysicalMat(0xc07820, {
  roughness: 0.35,
  clearcoat: 0.85,
  clearcoatRoughness: 0.08,
});
stdlib.applyPbr(floorMat, "wood_floor", 14);

// ✅ CORRECT — glass backboard
const glassMat = stdlib.makePhysicalMat(0xc8e4f8, {
  roughness: 0.04,
  transmission: 0.92,
  ior: 1.52,
  thickness: 0.05,
});

// ❌ WRONG — using makeMat for a surface the camera sees up close
const floorMat = stdlib.makeMat(0xc07820, 0.45, 0.0);  // no clearcoat, looks flat/matte
```

### Material reference table

| Surface | color (hex) | roughness | metalness | notes |
|---|---|---|---|---|
| Hardwood floor (light oak) | `0xc8a46e` | 0.35 | 0.0 | use `makePhysicalMat` with clearcoat=0.8 |
| Hardwood floor (dark walnut) | `0x6b4226` | 0.4 | 0.0 | use `makePhysicalMat` with clearcoat=0.9 |
| Concrete floor | `0x9e9e9e` | 0.85 | 0.0 | `applyPbr("concrete_floor_02", 8)` |
| Painted wall (white) | `0xf2efe8` | 0.92 | 0.0 | slight warm tint, not pure white |
| Painted wall (colored) | your choice | 0.88 | 0.0 | |
| Brick wall | `0xc1693a` | 0.9 | 0.0 | `applyPbr("red_brick_03", 6)` |
| Plaster / stucco | `0xddd5c8` | 0.95 | 0.0 | |
| Glass (window) | `0xadd8e6` | 0.05 | 0.0 | use `makePhysicalMat` with transmission |
| Polished marble | `0xe8e4de` | 0.1 | 0.0 | low roughness = visible reflections |
| Brushed steel | `0xb0b8c0` | 0.35 | 0.95 | |
| Rusted iron | `0x8b4513` | 0.85 | 0.6 | |
| Shiny chrome | `0xd4d4d4` | 0.05 | 1.0 | |
| Basketball court | `0xd4824a` | 0.6 | 0.0 | orange-tan wood |
| Grass (synthetic) | `0x3a7d44` | 0.95 | 0.0 | `applyPbr("aerial_grass_rock", 30)` for real grass |
| Asphalt / road | `0x333333` | 0.95 | 0.0 | |
| Cobblestone | `0x7a7060` | 0.9 | 0.0 | `applyPbr("cobblestone_floor_01", 10)` |
| Sand | `0xe2c98a` | 0.98 | 0.0 | |
| Water (still) | `0x1a6fa8` | 0.05 | 0.0 | use `stdlib.makeWater()` instead |
| Fabric / cloth | `0x8b7355` | 0.98 | 0.0 | near-1 roughness, 0 metalness |
| Skin | `0xffcba4` | 0.7 | 0.0 | use GLTF model, not raw mesh |
| Emissive screen | `0x002244` | 1.0 | 0.0 | set `emissive` + `emissiveIntensity 1.5–3` |

```javascript
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

### `stdlib.makeWorldTerrain(opts?)` → `THREE.Group`  ⭐ USE FOR OPEN-WORLD LANDSCAPES

Generates a large terrain chunk with procedural heightmap + TSL biome auto-transition material.
Altitude-driven colour: deep water → shallow → sand → grass → rock → snow.
Includes a semi-transparent sea plane at `seaLevel`.

The height function is **deterministic world-space**: same seed + coordinates always
produce the same terrain. Multiple chunks tile seamlessly.

```typescript
stdlib.makeWorldTerrain(opts?: {
  seed?:      number;  // noise seed — controls which terrain shape (default 42)
  size?:      number;  // world-space extent in metres (default 1000)
  samples?:   number;  // height grid resolution (default 128 — 127×127 mesh segs)
  amplitude?: number;  // peak-to-trough height in metres (default 40)
  seaLevel?:  number;  // water plane y position (default -5)
  originX?:   number;  // world-space X centre of chunk (default 0)
  originZ?:   number;  // world-space Z centre of chunk (default 0)
}): THREE.Group
```

**IMPORTANT:** Call `stdlib.configureTerrain(seed, { amplitude })` with the same seed BEFORE
placing any objects so that `stdlib.getTerrainHeight(x, z)` returns matching heights.

```typescript
// Open-world landscape setup
stdlib.setupLighting({ hdri: true, skybox: "dynamic_sky", sunElevation: 35 });
stdlib.configureTerrain(7, { amplitude: 50, seaLevel: 0 });
const terrain = stdlib.makeWorldTerrain({ seed: 7, size: 800, amplitude: 50, seaLevel: -8 });
scene.add(terrain);

// Place a tree at correct terrain height
const tx = 30, tz = -20;
const ty = stdlib.getTerrainHeight(tx, tz);
await stdlib.placeAsset("tree_pine_01", { position: { x: tx, y: ty, z: tz } });
```

### `stdlib.configureTerrain(seed, opts?)` → void

Configure the global terrain noise. Call this ONCE before any `getTerrainHeight()` queries
or `makeWorldTerrain()` calls — it sets the deterministic seed and parameters.

```typescript
stdlib.configureTerrain(seed: number, opts?: {
  frequency?:    number;  // base frequency cycles/metre (default 1/200)
  octaves?:      number;  // fractal layers (default 6)
  lacunarity?:   number;  // frequency multiplier per octave (default 2.0)
  persistence?:  number;  // amplitude multiplier per octave (default 0.5)
  amplitude?:    number;  // peak-to-trough metres (default 40)
  seaLevel?:     number;  // base height offset (default 0)
})
```

### `stdlib.getTerrainHeight(wx, wz)` → `number`

Returns terrain height (metres) at world position (wx, wz).
Uses the global noise configured by `configureTerrain()`. Deterministic — safe to call per-frame.

```typescript
const groundY = stdlib.getTerrainHeight(x, z);
mesh.position.set(x, groundY + halfHeight, z);
```

### `stdlib.colorFor(type)` → `number`

Returns a palette color: `"building"`, `"terrain"`, `"tree"`, `"npc"`, `"item"`, `"object"`.

### `stdlib.seed(x, z)` → `number`

Deterministic pseudo-random 0–1 value keyed to (x, z). Use for stable per-object variation.

### `stdlib.invalidate()`

Signals the renderer to render the next frame. Call after async asset loads complete.

### `stdlib.addAmbientSound(url, volume?)` → AudioContext

Play a looping background sound.

```typescript
stdlib.addAmbientSound(url: string, volume?: number): AudioContext
// volume: 0–1 linear gain, default 0.4
```

**Note:** Do NOT use hardcoded CDN URLs for ambient sound — they rot and cause 404 errors that flood the console. Use `addAmbientSound` only when you have a reliable URL. Omit it when uncertain.

---

## Asset Catalog (Free CDNs)

**Use these URLs directly in `stdlib.loadModel()` or `stdlib.makeNpc()`. All verified working.**

CDN prefixes:
- `THR` = `https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/models/gltf`
- `KHR` = `https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models`
- `KNY` = `https://cdn.jsdelivr.net/gh/KenneyNL`

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

**Default for any human NPC**: use `Soldier.glb` at scale 1.0, y=0.

### Vehicles

| Model | URL | Scale | Notes |
|---|---|---|---|
| Milk truck (animated wheels) | `KHR/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb` | 1.0 | ~4m long |
| Concept car (PBR) | `KHR/CarConcept/glTF-Binary/CarConcept.glb` | 1.0 | ~4.5m long |
| Toy car | `KHR/ToyCar/glTF-Binary/ToyCar.glb` | 30 | toy scale, high-quality PBR |
| Low-poly truck (green) | `KNY/Starter-Kit-Racing@master/models/vehicle-truck-green.glb` | 1.0 | MIT |

### Buildings & Urban Props (KenneyNL — MIT license)

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

### Usage patterns

```javascript
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

**Consequence for sports courts**: A basketball/football court along X-axis has its far goal at negative Z, near goal at positive Z. The camera (at z=20) looks inward. Never place the near wall at z < 20.

### Indoor scene checklist (FOLLOW EVERY TIME `isIndoor: true`)

1. `stdlib.setupLighting({ isIndoor: true })` — auto-hides world grass ground, sets dark background
2. `scene.fog = null` — fog at y=0 has no meaning inside a building
3. Camera INSIDE the enclosure: `camera.position.set(x, 1.7, z_inside)` where `z_inside` is well inside the far wall
4. The enclosure must be large enough that the camera starts inside it
5. For arenas: walls at ±half-width in X and ±half-depth in Z; ceiling at top; no floor gap

### Basketball hoop geometry (correct orientation)

Court lies along X-axis. Baselines at `x = ±14`. Camera is at positive Z looking toward −Z.

```
For left goal  (x = -14): pole at x=-15.5, arm extends right (+x), rim at x=-12.8
For right goal (x = +14): pole at x=+15.5, arm extends left  (-x), rim at x=+12.8
Rule: rim is INSIDE the baseline, pole is OUTSIDE the baseline.
```

```javascript
function addHoop(baselineX) {
  const inward = baselineX > 0 ? -1 : 1;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.5, 8), metalMat);
  pole.position.set(baselineX - inward * 1.5, 1.75, 0);
  scene.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), metalMat);
  arm.position.set(baselineX - inward * 0.9, 3.4, 0);
  scene.add(arm);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 1.83), boardMat);
  board.position.set(baselineX - inward * 0.25, 3.35, 0);
  scene.add(board);
  const rimPts = Array.from({ length: 33 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * 0.23, 0, Math.sin(a) * 0.23);
  });
  const rim = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), 32, 0.022, 8, true),
    hoopMat
  );
  rim.position.set(baselineX + inward * 1.2, 3.05, 0);
  scene.add(rim);
}
addHoop(-14);
addHoop(14);
```

### Outdoor landscape

```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });
const ground = stdlib.makeTerrain("floor", { width: 100, depth: 100, position: { x: 0, y: 0, z: 0 } });
stdlib.makeTerrain("hill", { width: 20, height: 10, position: { x: -18, y: 0, z: -25 } });
stdlib.makeTerrain("hill", { width: 16, height:  7, position: { x:  14, y: 0, z: -22 } });
for (let i = 0; i < 8; i++) {
  const x = (stdlib.seed(i, 0) - 0.5) * 40;
  const z = stdlib.seed(0, i) * 15 - 5;
  stdlib.makeTree({ position: { x, y: 0, z }, scale: 0.8 + stdlib.seed(i, i) * 0.5 });
}
stdlib.makeBuilding({ position: { x: -6, y: 0, z: -5 }, height: 8 });
stdlib.makeNpc({
  position: { x: 2, y: 0, z: 2 },
  modelUrl: "https://threejs.org/examples/models/gltf/Soldier.glb",
  idleClip: "Idle", moveMode: "randomwalk", maxRadius: 4,
});
```

### Indoor room

```javascript
stdlib.setupLighting({ isIndoor: true });
scene.fog = null;
camera.position.set(0, 1.7, 5);
camera.lookAt(0, 1.5, -3);
const HALF_W = 6, HALF_D = 8, H = 3.2;
stdlib.makeTerrain("floor",   { width: HALF_W*2, depth: HALF_D*2, position: { x: 0, y: 0, z: 0 } });
stdlib.makeTerrain("ceiling", { width: HALF_W*2, depth: HALF_D*2, position: { x: 0, y: H, z: 0 } });
stdlib.makeTerrain("wall",    { width: HALF_W*2, height: H, position: { x:  0,      y: H/2, z: -HALF_D } });
stdlib.makeTerrain("wall",    { width: HALF_W*2, height: H, position: { x:  0,      y: H/2, z:  HALF_D } });
stdlib.makeTerrain("wall",    { width: HALF_D*2, height: H, position: { x: -HALF_W, y: H/2, z: 0 } });
stdlib.makeTerrain("wall",    { width: HALF_D*2, height: H, position: { x:  HALF_W, y: H/2, z: 0 } });
const tex = stdlib.makeCanvasTexture("欢迎光临", { bg: "#163a25", fg: "#f0ece4", font: "bold 64px serif" });
const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshStandardMaterial({ map: tex }));
sign.position.set(0, 2.5, -HALF_D + 0.05);
scene.add(sign);
```

### Animated particle scene

```javascript
stdlib.setupLighting({ skybox: "night", hdri: false });
scene.background = new THREE.Color(0x060818);
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
