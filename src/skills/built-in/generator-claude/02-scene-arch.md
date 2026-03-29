## Scene Architecture (READ BEFORE WRITING ANY CODE)

Visual coherence comes from following the same spatial logic that exists in the real world. Every scene must satisfy all requirements below before adding any props or characters.

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

### Requirement 4 — Dominant anchor fills 40% of the viewport

Every scene must have one element that occupies at least 40% of the viewport from the default camera. Supporting elements fill the rest and reinforce the anchor.

**Test**: if you can mentally cover the dominant anchor with your thumb and the scene still "reads the same", the anchor is not dominant enough. Make it bigger, bring the camera closer, or reframe to face it directly.

Dominant anchor types by scene:
- A large water body (river, lake, sea) — fills the bottom 40%+ of the frame
- A dramatic cliff or karst peak — fills the background 40%+
- A dense forest or bamboo wall — fills 60%+ before the clearing
- A monument or focal structure — centered and at least 30% of frame height

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
