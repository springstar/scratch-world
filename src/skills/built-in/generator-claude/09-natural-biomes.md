## Natural Environments: Biomes, Scatter, and Color Palettes

This document is **mandatory reading** before generating any natural environment scene (forest, jungle, river, desert, savanna, coast, grassland). The Amazon failure mode — uniform tree rows, wrong water color, no atmosphere — stems from ignoring biome-specific rules.

---

### Natural Scatter Algorithm (MANDATORY — replaces all loops and grids)

NEVER place trees, rocks, or bushes in regular grids or uniform loops. Real forests have clusters, gaps, and irregular spacing driven by soil, light, and competition.

**Golden-angle jitter scatter** — use this pattern for ALL vegetation placement:

```javascript
// Place N trees in a radius R around center (cx, cz)
// Uses golden angle (137.5°) to avoid rows/columns
function scatterVegetation(cx, cz, count, minR, maxR, makeItem) {
  const phi = 2.399963; // golden angle in radians (137.5°)
  for (let i = 0; i < count; i++) {
    const r = minR + (maxR - minR) * Math.sqrt((i + 0.5) / count);
    const theta = i * phi + (Math.sin(i * 7.3) * 0.4); // jitter theta
    const x = cx + r * Math.cos(theta);
    const z = cz + r * Math.sin(theta);
    makeItem(x, z, i);
  }
}

// Example: 30 trees spread from radius 8 to 50 around scene center
scatterVegetation(0, -20, 30, 8, 50, (x, z, i) => {
  const scale = 0.8 + Math.sin(i * 2.7) * 0.3; // size variation
  stdlib.makeTree({ position: { x, y: 0, z }, scale });
});
```

**Cluster scatter** — for forests with clearings (tropical rainforest, temperate forest):

```javascript
// 3–4 clusters with dense internal scatter + sparse fill between
const clusters = [
  { cx: -12, cz: -25, r: 14, count: 10 },
  { cx:  15, cz: -18, r: 12, count:  8 },
  { cx:   0, cz: -45, r: 18, count: 14 },
];
clusters.forEach(({ cx, cz, r, count }) => {
  scatterVegetation(cx, cz, count, 2, r, (x, z, i) => {
    stdlib.makeTree({ position: { x, y: 0, z }, scale: 1.0 + (i % 3) * 0.2 });
  });
});
// Sparse fill in the gaps
scatterVegetation(0, -25, 6, 20, 55, (x, z, i) => {
  stdlib.makeTree({ position: { x, y: 0, z }, scale: 0.7 + (i % 4) * 0.15 });
});
```

**NEVER use:**
```javascript
// BAD — produces palace rows
for (let x = -20; x <= 20; x += 5) {
  for (let z = -40; z <= -10; z += 5) {
    stdlib.makeTree({ position: { x, y: 0, z } });
  }
}
```

---

### Biome 1 — Tropical Rainforest (Amazon, Southeast Asia, Congo)

**Visual signature**: Multi-layer canopy (emergent trees 40–60 m above dense 20–30 m canopy), almost zero sky visible from forest floor, green-filtered light, high humidity haze.

**Palette**:
```
Canopy top:    0x1a4a1a  (very dark emerald)
Midcanopy:     0x2d6e1e  (deep forest green)
Undergrowth:   0x1e3d14  (near-black green)
Bark / ground: 0x3a2918  (dark wet earth)
Leaf litter:   0x4a3822  (rotting matter brown)
Water (Amazon main channel):  0x5a4020  (turbid muddy brown)
Water (black-water tributary): 0x1a1208  (dark tannin black)
Mist / fog:    0x6a7a50  (greenish grey)
```

**Atmosphere**:
```javascript
stdlib.setupLighting({ skybox: "overcast", hdri: true });
scene.fog = new THREE.FogExp2(0x6a7a50, 0.028);  // heavy canopy mist
// Weak ambient — canopy blocks direct sun almost completely
```

**Trees**: Multi-height layers — mix tall `scale: 1.6–2.0` emergent trees with dense `scale: 1.0–1.4` canopy. Use cluster scatter with HIGH density (30–40 trees for a 60×60 m patch).

**Ground**: Dark wet earth, no grass, leaf litter patches. Use `makeTerrain("floor")` with `color: 0x3a2918`.

**River color correction**: Amazon is MUDDY BROWN (sediment load from the Andes). NEVER use teal, blue, or green.
```javascript
// Correct Amazon river color
stdlib.makeRiver({ waterColor: 0x5a4020, width: 30, meander: 0.4 });
```

**NPC hint**: Any characters in Amazonian settings must be `stdlib.placeAsset("character_tribal")` or `stdlib.loadModel(url)` — BoxGeometry humans are unacceptable.

---

### Biome 2 — Temperate Deciduous Forest (North America, Europe, Northeast China)

**Visual signature**: Dappled light through canopy gaps, visible sky through trees, carpet of undergrowth, seasonal muting.

**Palette**:
```
Summer canopy:  0x3a6b20  (medium leaf green)
Autumn canopy:  0xc8601a  (amber orange)
Bark:           0x5a4030  (brown-grey)
Ground:         0x2a3a18  (moss/grass green)
Leaf litter:    0x6a5028  (autumn brown)
Water (stream): 0x3a5a70  (clear with rock tint — blue-grey, not teal)
Mist:           0xa0b0a0  (grey-green overcast)
```

**Atmosphere**:
```javascript
stdlib.setupLighting({ skybox: "dynamic_sky", sunElevation: 35, hdri: true });
scene.fog = new THREE.FogExp2(0xa0b0a0, 0.014);
```

**Trees**: Medium density, visible gaps. 20–25 trees for a 60×60 m scene. Mix tree sizes (scale 0.8–1.5). Leave clearings.

---

### Biome 3 — River Valley / Gorge (湘西, Li River, Three Gorges)

**Visual signature**: River as central horizontal axis, mist clinging to water surface and hillsides, karst or forested ridges framing the sides.

**Palette**:
```
Water (茶色 — tannin-rich mountain river): 0x4a6a5a  (dark grey-green, NOT teal)
Water (Li River, Guilin):                  0x4a7070  (jade grey-green)
Karst rock:   0x6a7060  (limestone grey-green)
Hillside:     0x2a4a1a  (dark forest green)
Mist:         0xb0b8a8  (pale grey-green)
Stilted wood: 0x5a4028  (dark weathered timber)
Wet tile:     0x5a5050  (grey)
```

**Atmosphere**:
```javascript
stdlib.setupLighting({ skybox: "overcast", hdri: true });
scene.fog = new THREE.FogExp2(0x9ab0aa, 0.022);  // mountain mist
```

**Key rule**: River must run along the z-axis (use `makeRiver`), buildings cluster on the banks, karst peaks recede into the mist background.

---

### Biome 4 — Savanna / African Grassland

**Visual signature**: Flat or gently rolling dry grassland, isolated acacias with flat crowns, distant mountains or horizon, harsh directional sun.

**Palette**:
```
Dry grass:    0xc8a850  (golden straw)
Acacia bark:  0x5a3a10  (dark brown)
Acacia crown: 0x4a6a20  (dusty flat-top green)
Dry earth:    0xc8a060  (laterite orange-tan)
Sky:          0x5a90d0  (African blue)
Haze:         0xd4b870  (dust haze)
Water (waterhole): 0x6a6040  (murky brown-green)
```

**Atmosphere**:
```javascript
stdlib.setupLighting({ skybox: "dynamic_sky", sunElevation: 55, sunAzimuth: 160, hdri: true });
scene.fog = new THREE.FogExp2(0xd4b870, 0.006);  // light dust haze — sparse, not dense
```

**Trees**: SPARSE. 5–8 trees for a 100×100 m scene. Trees are isolated, not clustered. Scale 0.9–1.3. Give each tree its own territory — minimum 15 m spacing.

---

### Biome 5 — Desert (Sahara, Gobi, Arabian)

**Visual signature**: Extreme directional light, no vegetation or very sparse (1–2 plants per 100 m), heat shimmer, dunes or rocky flat.

**Palette**:
```
Sand:         0xe0c870  (warm gold)
Rock:         0xb09060  (bleached sandstone)
Shadow:       0x7a6040  (deep sand shadow)
Sky horizon:  0xf0d080  (bleached near-horizon)
Sky zenith:   0x3060a0  (deep blue)
Fog / haze:   0xe8d090  (sand-dust haze)
```

**Atmosphere**:
```javascript
stdlib.setupLighting({ skybox: "dynamic_sky", sunElevation: 65, hdri: true });
scene.fog = new THREE.FogExp2(0xe8d090, 0.004);  // extremely light haze
// Almost no fog — deserts have very clear air except during sandstorms
```

**Trees**: NONE unless there's an oasis. For oasis: tight cluster of 3–5 palms using `stdlib.placeAsset("tree_palm_01")`.

---

### Biome 6 — Coastal / Beach

**Visual signature**: Strong horizontal line (horizon), wave action, salt haze, cliffs or dunes depending on region.

**Palette**:
```
Ocean (deep):  0x1a4060  (dark navy)
Ocean (shallow): 0x2a7090  (turquoise-blue)
Wave foam:     0xe8f0f0  (near white)
Sand:          0xe0d0a0  (warm light sand)
Sea haze:      0x90b0c0  (salty grey-blue)
```

**Atmosphere**:
```javascript
stdlib.setupLighting({ skybox: "clear_day", hdri: true });
scene.fog = new THREE.FogExp2(0x90b0c0, 0.010);  // sea salt haze
```

---

### Biome 7 — Bamboo Forest (Sichuan, Arashiyama)

**Visual signature**: Dense vertical wall of pale green culms, filtered overhead light, almost no understory, narrow paths.

**Palette**:
```
Culm (fresh):  0x7a9a50  (light yellow-green)
Culm (mature): 0x5a7840  (medium green)
Culm (aged):   0x4a6030  (dark green)
Leaf canopy:   0x3a5820  (deep filter green)
Ground:        0x2a3a18  (dark moss)
Fog:           0xa0b090  (green-grey mist)
```

**Atmosphere**:
```javascript
stdlib.setupLighting({ skybox: "overcast", hdri: true });
scene.fog = new THREE.FogExp2(0xa0b090, 0.035);  // dense — bamboo blocks sight lines
```

**Bamboo placement**: Tight grid IS acceptable for bamboo (they grow in rhizome clumps), but with spacing variation. NOT the same uniform loop used for trees.

```javascript
// Bamboo — tight but irregular (NOT tree scatter)
for (let i = 0; i < 60; i++) {
  const x = (Math.random() - 0.5) * 40 + Math.sin(i * 1.3) * 3;
  const z = -10 - (Math.random() * 40) + Math.cos(i * 2.1) * 2;
  const culm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.06, 10 + Math.random() * 5, 6),
    stdlib.makeMat(0x5a7840 + (i % 3) * 0x0a1008, 0.9, 0.1)
  );
  culm.position.set(x, 5 + Math.random() * 2, z);
  scene.add(culm);
}
```

---

### Water Color Quick Reference

| Water body | Correct hex | Why |
|---|---|---|
| Amazon main channel | `0x5a4020` | Andes sediment — turbid brown |
| Amazon blackwater tributary | `0x1a1208` | Tannin from leaf litter — near black |
| Yangtze River | `0x4a5a3a` | Turbid grey-green (pre-dam era tan) |
| Li River / Guilin | `0x4a7070` | Relatively clear but still tinted grey-green |
| 湘西 Tuojiang | `0x3a5a4a` | Dark teal-green with mountain tannins |
| Mountain stream (clear) | `0x3a5a70` | Rock-tinged blue-grey |
| Tropical ocean (shallow) | `0x2a7090` | Turquoise |
| Deep ocean | `0x1a3050` | Dark navy |
| Swamp / mangrove | `0x2a3a20` | Algae-dark green |
| Desert oasis | `0x4a7060` | Mineral blue-green |
| WRONG: generic teal | `0x2d5a6e` | Only acceptable for generic pools |

---

### Scene Density Guidelines

| Biome | Trees per 60×60 m patch | Scatter type |
|---|---|---|
| Tropical rainforest | 35–50 | Cluster (3–4 clusters) + sparse fill |
| Temperate forest | 18–28 | Cluster (2–3 clusters) |
| River valley hillside | 15–22 | Cluster on slopes |
| Savanna | 4–8 | Isolated (min 15 m spacing) |
| Desert | 0–2 | Isolated (near oasis only) |
| Bamboo forest | 50–80 culms | Tight rhizome-grid with jitter |
| Temperate park/garden | 6–12 | Golden-angle scatter |

---

### Atmosphere Preset Quick-Lookup

| Biome/mood | skybox | fog type | fog color | fog density | hdri |
|---|---|---|---|---|---|
| Tropical rainforest | overcast | FogExp2 | 0x6a7a50 | 0.028 | true |
| Dense temperate forest | overcast | FogExp2 | 0xa0b0a0 | 0.016 | true |
| River valley morning mist | overcast | FogExp2 | 0x9ab0aa | 0.022 | true |
| Savanna afternoon | dynamic_sky (elev 55) | FogExp2 | 0xd4b870 | 0.006 | true |
| Desert midday | dynamic_sky (elev 65) | FogExp2 | 0xe8d090 | 0.004 | true |
| Coastal clear | clear_day | FogExp2 | 0x90b0c0 | 0.010 | true |
| Bamboo / Asian forest | overcast | FogExp2 | 0xa0b090 | 0.032 | true |
| Snowy tundra | overcast | Fog | 0xd0dde0 | (linear, far=200) | true |

---

### Displaced Terrain — `stdlib.makeDisplacedGround()`

Use for any natural outdoor scene where a flat ground plane breaks immersion.

```javascript
// Replace makeTerrain("floor") with makeDisplacedGround for natural environments:
stdlib.makeDisplacedGround({ size: 120, amplitude: 4, seed: 42, color: 0x4a5a30 });
```

**Amplitude guide:**
| Value | Terrain feel |
|---|---|
| 1–2 | Gentle meadow, barely perceptible roll |
| 3–6 | Rolling hills, visible undulation |
| 8–12 | Dramatic terrain, sharp ridges |

**Rules:**
- Call `makeDisplacedGround()` **before** `forestZone()` — trees are placed at y=0, so ground must be set up first
- Do **not** combine with `makeTerrain("floor")` at y=0 — they overlap and z-fight
- Biome-matched colors: temperate forest `0x4a6030`, river valley `0x4a5a38`, savanna `0xc8a048`, tropical `0x3a2918`
- `seed` must be deterministic — use a consistent number per scene, not `Math.random()`
