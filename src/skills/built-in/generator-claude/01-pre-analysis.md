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

### Step 3 — Extract cultural/regional signals

If the prompt names a location or culture, identify before coding:
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

### Step 5 — Write a one-paragraph spatial plan

Before writing sceneCode, write (internally) a plan that names:
- The dominant anchor and where it sits (which half of the scene, which y-level)
- The terrain type and the stdlib primitive(s) that build it
- The lighting preset and fog density/color
- Which layout type or raw-coordinate approach you will use

**Only after completing Steps 1–5 do you write sceneCode.**
