## Environment Design Methodology

This document replaces all piecemeal tree/scatter/biome rules with a single unified design process. Read this before generating ANY natural or outdoor scene.

**The fundamental error to never repeat:** Thinking about a forest as "30 trees placed at (x, z) coordinates." A forest is a ZONE with an ECOLOGICAL DISTRIBUTION. You define the zone and let the distribution algorithm fill it. You never manually coordinate individual trees.

---

### The Foliage Tool Mental Model

In Unreal Engine, the foliage painter tool works like this:
1. The artist defines a zone (by painting on the terrain)
2. The artist sets a density (trees per 100 m²)
3. The engine scatters trees automatically with random orientation and scale variation
4. The artist never types a single (x, z) coordinate

This is the mental model to use here. Every vegetation placement must follow:
```
DEFINE ZONE → SET DENSITY → SCATTER → never type individual coordinates for 4+ trees
```

---

### Anti-Pattern: The Colonnade Failure

This code produces the screenshot of "palace columns in a row" — not a forest:

```javascript
// FATAL ANTI-PATTERN — produces military parade, colonnade, or army barracks
for (let x = -20; x <= 20; x += 4) {
  for (let z = -50; z <= -10; z += 5) {
    stdlib.makeTree({ position: { x, y: 0, z }, scale: 1 }); // rows + equal height
  }
}
```

Failure modes in this code:
- `x += 4`: constant column spacing → columns
- `z += 5`: constant row spacing → rows
- `scale: 1`: every tree identical height
- Result: viewed from camera = wall of identical pillars

---

### Canonical Scatter Pattern (memorize this)

```javascript
// CORRECT: Zone-based scatter — equivalent to Unreal foliage tool
function forestZone(cx, cz, r, count) {
  const phi = 2.399963; // golden angle — distributes without rows or columns
  for (let i = 0; i < count; i++) {
    const radius = r * 0.15 + (r * 0.85) * Math.sqrt((i + 0.5) / count);
    const theta = i * phi + Math.sin(i * 7.3) * 0.5; // jitter breaks regularity
    const x = cx + radius * Math.cos(theta);
    const z = cz + radius * Math.sin(theta);
    // Height classes: 5 distinct scale bands, not random float soup
    const heightClass = i % 5;
    const scale = [0.65, 0.85, 1.0, 1.15, 1.4][heightClass];
    stdlib.makeTree({ position: { x, y: 0, z }, scale });
  }
}
```

Usage: `forestZone(5, -25, 30, 20)` — 20 trees in a 30 m radius zone centered at (5, -25).

For multiple clusters with clearings (most natural forests):
```javascript
// 3 clusters = realistic forest with gaps and clearings
forestZone(-12, -28, 14, 10); // cluster left
forestZone( 14, -22, 12, 8);  // cluster right
forestZone(  2, -48, 20, 14); // cluster background
// sparse infill between clusters
forestZone(  0, -33, 40, 5);  // 5 scattered background trees
```

---

### Phase 1: Environment Classification

Before writing ANY sceneCode, classify the environment. This single classification determines every downstream parameter.

| Prompt contains | Class | Distribution model | Density |
|---|---|---|---|
| forest / woods / woodland | TEMP_FOREST | 2–3 clusters, clearings | 18–28 per 60×60 m |
| amazon / jungle / tropical / rainforest | TROP_FOREST | 3–4 dense clusters | 35–50 per 60×60 m |
| savanna / safari / grassland / plains | SAVANNA | isolated, min 15 m spacing | 4–8 per 100×100 m |
| desert / dune / sahara / gobi | DESERT | none or 1–2 near oasis | 0–3 per 100×100 m |
| 竹林 / bamboo | BAMBOO | rhizome-grid with 0.5 m jitter | 50–80 culms per 30×30 m |
| city / street / plaza | URBAN | layout solver (03-layout-api.md) | N/A |
| park / garden / 公园 | GARDEN | golden-angle, visible spacing | 5–12 per 40×40 m |

---

### Phase 2: Height Stratification (MANDATORY for forests)

Real forests have 3–4 vertical layers. Rendering all trees at the same height is ecologically wrong regardless of what scatter pattern you use.

**Tropical forest** (4 layers):
```javascript
// Layer 1: Emergent trees — visible above canopy (scale 1.6–2.0, count: 10% of total)
// Layer 2: Canopy — the main green mass (scale 1.0–1.4, count: 50% of total)
// Layer 3: Understory — smaller trees in shade (scale 0.6–0.9, count: 30% of total)
// Layer 4: Ground shrubs — use stdlib.makeMat() low green meshes (count: 10%)

// Implementation: use 4 separate forestZone() calls with different scale bands
forestZone(0, -30, 40, 4, { scaleMin: 1.6, scaleMax: 2.0 }); // emergent
forestZone(0, -30, 35, 20, { scaleMin: 1.0, scaleMax: 1.4 }); // canopy
forestZone(0, -30, 28, 12, { scaleMin: 0.6, scaleMax: 0.9 }); // understory
```

**Temperate forest** (3 layers):
```javascript
// Overstorey (scale 1.2–1.6), middle (0.8–1.1), saplings (0.4–0.7)
```

**Savanna** (2 layers):
```javascript
// Canopy (flat-top acacia, scale 1.0–1.3): isolated trees with individual placement
// Ground (dry grass — use makeTerrain("floor") with grass texture)
```

---

### Phase 3: Ecological Placement Logic

Each environment class has an ecological reason for its distribution. Understanding the reason prevents mistakes:

| Class | Ecological driver | Visual result |
|---|---|---|
| Tropical forest | Trees compete for light gaps in canopy | Clusters around gaps, no sunlight at ground level |
| Temperate forest | Trees compete for light from edges, water | Clusters near edges, open center possible |
| Savanna | Trees compete for water → minimum spacing → ISOLATION, not clusters | Isolated flat-top acacias, open grass between |
| Desert | Extreme water scarcity → very sparse, near dry rivers/oases | Empty landscape punctuated by rare plants |
| Garden | Human-planted → symmetry acceptable | Regular spacing IS correct for cultivated gardens |
| Street trees | Planted by municipalities → ROWS are correct | For boulevards: rows along sidewalk are realistic |

**The key rule**: rows and grids are WRONG for natural environments, and CORRECT for cultivated or urban ones. Champs-Élysées plane trees are in rows. Amazon rainforest is never in rows.

---

### Phase 4: Scale Variation Rules

NEVER pass the same `scale` value to multiple trees. Use one of these patterns:

```javascript
// Pattern A: 5-class rotation (predictable variation)
const scales = [0.65, 0.85, 1.0, 1.2, 1.45];
stdlib.makeTree({ position: {...}, scale: scales[i % 5] });

// Pattern B: deterministic pseudo-random from index
const scale = 0.7 + (Math.sin(i * 2.7 + 1.1) * 0.5 + 0.5) * 0.7; // 0.7–1.4

// Pattern C: height-zone assignment (most realistic)
// First 30% of trees: scale 1.3–1.6 (overstorey)
// Next 50%: scale 0.85–1.15 (canopy)
// Last 20%: scale 0.5–0.75 (understorey)
```

Never: `scale: 1` or any constant applied to all trees.

---

### Phase 5: Camera Placement for Natural Scenes

Camera placement that makes scenes read correctly:

**Forest / jungle**: Camera at forest EDGE looking IN, not inside looking at wall. The viewer sees depth into the forest, not a wall of trunks.
```javascript
// Camera at edge looking into forest at an angle
camera.position.set(8, 1.7, 8);
controls.target.set(-5, 3, -20); // looking into the canopy at an angle
```

**River scene**: Camera on riverbank, river as horizontal mid-ground axis. Never face the river at 90° from above — always at a slight diagonal.

**Savanna**: Low horizon, camera at 1.5 m, wide FOV, individual trees in foreground at 5–8 m, more in mid at 20–40 m, distant hills at 200 m.

---

### Quick Self-Check: Is This Code a Colonnade?

Before submitting any sceneCode, look at every loop that calls `makeTree`:

```
IF loop variable x increments by a constant AND z is fixed → colonnade (WRONG)
IF loop variable z increments by a constant AND x is fixed → row of trees (WRONG)
IF nested for(x) for(z) → grid (WRONG for natural scenes)
IF using forestZone() or golden-angle pattern → OK
IF trees have at least 3 different scale values → OK
IF no two adjacent trees share identical (x, z) spacing → OK
```

If any "WRONG" condition is true: rewrite using `forestZone()` before submitting.
