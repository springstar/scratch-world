## Scene Pre-Analysis (MANDATORY — run before every create_scene or update_scene)

Before writing a single line of sceneCode, complete this 5-step analysis in your internal reasoning. The analysis is for you — do not recite it to the user, but do not skip it.

**If the prompt names a real-world city, landmark, or street: run `06-research.md` §Research Protocol BEFORE Step 1.**

### Step 1 — Identify the dominant anchor

Ask: **"What ONE element fills 40%+ of the visual field from the default camera?"**

This becomes Layer 6 (Focal Object) and every other layer serves it.

Examples:
- "湘西古镇" → dominant anchor: the tuo river winding between stilted houses
- "Las Vegas strip at night" → dominant anchor: the lit casino corridor
- "bamboo forest" → dominant anchor: the dense vertical bamboo wall
- "a park bench on a sunny day" → dominant anchor: the bench itself (simple scene = small anchor is fine)

**If you cannot name the dominant anchor in one sentence, stop and think harder before writing code.**

### Step 2 — Identify the terrain signature

Ask: **"What does the ground do in this scene?"** Flat is the exception for natural environments.

| Signature | Examples |
|---|---|
| **flat** | desert, sports courts, plazas, indoor rooms, rice plains |
| **stepped/terraced** | terraced farmland, amphitheater, vineyard hillside |
| **undulating** | rolling meadows, English countryside, golf course |
| **steep + river** | river gorge, mountain valley — river runs at the base |
| **cliff + drop** | coastal cliff, mesa, karst peaks rising from flat valley floor |
| **elevated + view** | hilltop lookout, rooftop, mountain pass |

### Step 3 — Extract cultural/regional signals AND biome

**For natural environments (forest, jungle, river, desert, savanna, coast, grassland):**
Identify the biome first, then look up its color palette and scatter rules in `09-natural-biomes.md`.

| Prompt contains | Biome | Mandatory lookup |
|---|---|---|
| amazon / tropical / jungle / rainforest | Tropical Rainforest | 09-natural-biomes §Biome 1 |
| forest / woods / woodland (temperate) | Temperate Forest | 09-natural-biomes §Biome 2 |
| 湘西 / li river / gorge / river valley / 山谷 | River Valley | 09-natural-biomes §Biome 3 |
| savanna / safari / african plains | Savanna | 09-natural-biomes §Biome 4 |
| desert / dunes / sahara / gobi | Desert | 09-natural-biomes §Biome 5 |
| beach / coast / ocean / seaside | Coastal | 09-natural-biomes §Biome 6 |
| bamboo / 竹林 / arashiyama | Bamboo Forest | 09-natural-biomes §Biome 7 |

**Water color is determined by biome — not by aesthetic preference.** Check the Water Color Quick Reference in `09-natural-biomes.md`.

**For urban/built environments** (city, town, room, interior): identify cultural context:
- **Building material + style**: timber frame / stone / concrete / mud-brick / bamboo...
- **Roof form**: pitched+tile / flat / thatched / curved eave (Chinese) / pagoda / straw...
- **Water relationship**: over water (stilted) / beside water / terraced toward water / none
- **Atmospheric condition**: perpetual mist / clear high-altitude / humid haze / dry desert air
- **Mandatory vegetation**: plane trees / palms / bamboo / conifers / none

For known regions, recall specific parameters from `06-research.md`.

### Step 4 — Pick layout type

Map Steps 1–3 to one of the available layout types:

| Terrain + Anchor | Layout type |
|---|---|
| River-valley, stilted buildings, water as central axis | `"outdoor_riverside"` |
| Hillside, terraced agriculture, buildings at elevation | `"outdoor_hillside"` |
| Flat open landscape, park, field, plaza | `"outdoor_open"` |
| Dense urban street corridor | `"outdoor_street"` |
| Sports court with bleachers | `"outdoor_soccer"` / `"outdoor_basketball"` |
| Indoor enclosed space | `"indoor_room"` / `"indoor_arena"` |
| None of the above | raw coordinates per §Advanced: custom layout |

### Step 5 — Write a structured SCENE_PARAMS block

Before writing sceneCode, emit the following comment block as the **first lines of sceneCode**. It is the single source of truth that drives every downstream stdlib call in this scene — fill every field from Steps 1–4.

```javascript
// SCENE_PARAMS
// anchor: "<dominant element, one phrase>"
// terrain: "<flat|stepped|undulating|steep+river|cliff+drop|elevated+view>"
// biome: "<river_valley|tropical|temperate|savanna|desert|coastal|bamboo|urban|indoor>"
// layout: "<outdoor_riverside|outdoor_hillside|outdoor_open|outdoor_street|outdoor_soccer|outdoor_basketball|indoor_room|indoor_arena>"
// lighting: { skybox: "<clear_day|sunset|night|overcast|dawn>", hdri: <true|false>, timeOfDay: "<morning|noon|afternoon|evening|night>" }
// density: { hero: <1-4>, medium: <4-12>, decorative: <0-8> }
// depth_layers: { fg: <metres>, mg: <metres>, bg: <metres> }
```

Example for "湘西古镇黄昏":
```javascript
// SCENE_PARAMS
// anchor: "stilt houses over tuo river"
// terrain: "steep+river"
// biome: "river_valley"
// layout: "outdoor_riverside"
// lighting: { skybox: "sunset", hdri: true, timeOfDay: "evening" }
// density: { hero: 3, medium: 10, decorative: 6 }
// depth_layers: { fg: 6, mg: 28, bg: 100 }
```

**Only after writing SCENE_PARAMS do you continue with the scene code.**

