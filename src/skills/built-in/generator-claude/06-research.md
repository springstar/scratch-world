## Research Protocol (RUN FIRST for any named real-world place)

**If the prompt names a real-world city, landmark, street, region, or cultural context — run this protocol before the 5-step pre-analysis in `01-pre-analysis.md`.**

**Step 0 — Call `web_search` first.** For any named real-world place, call the `web_search` tool with a targeted query before writing any code. Examples:
- `"Champs-Élysées boulevard width trees buildings"` — layout and architecture
- `"Arc de Triomphe dimensions height arch opening"` — exact geometry
- `"湘西凤凰古镇 建筑特色 地形"` — cultural and terrain details

Only fall back to training knowledge if `web_search` is unavailable or returns no useful results.

---

### Research Protocol

For any named real-world place, answer these questions in your internal reasoning before writing code:

```
1. DOMINANT VISUAL SIGNATURE
   What is the single most recognizable visual element of this place?
   (e.g. Arc de Triomphe for Champs-Élysées, karst peaks for Guilin/Xiangxi,
    canal grid for Suzhou, red torii gates for Fushimi Inari)
   → This becomes Layer 6 (focal object). If it has a known geometry, use makeGateway()
     or stdlib.loadModel() — never substitute with makeBuilding().

2. STREET / SPATIAL LAYOUT
   What is the actual spatial structure?
   (e.g. Champs-Élysées: 2km straight boulevard 70m wide, 8 lanes, wide tree-lined
    sidewalks, Arc at western end; NOT a generic narrow street)
   → Drives layout type choice and corridor dimensions.

3. ARCHITECTURAL MATERIAL & STYLE
   What do the buildings look like?
   (e.g. Paris Haussmann: 5-7 floors, cream limestone facade, zinc mansard roof,
    wrought iron balconies, uniform cornice height ~20m)
   → Drives makeBuilding() color, height, and whether to use loadModel().

4. VEGETATION
   What trees/plants are present and where?
   (e.g. Champs-Élysées: double rows of plane trees on both sidewalk edges,
    spacing ~8m, height ~15m; NOT random scattered trees)
   → Drives tree placement pattern.

5. ATMOSPHERE & LIGHTING
   What is the typical atmospheric condition?
   (e.g. Paris: mild overcast or clear, European light, not tropical haze;
    Xiangxi: perpetual mountain mist, grey-green humidity;
    Sahara: flat glare, no fog)
   → Drives skybox, hdri, fog type and density.

6. COLOR PALETTE
   What are the 4-5 dominant hex colors?
   Research from memory — do not default to generic "warm tones".
   (e.g. Haussmann Paris: limestone cream 0xede8d8, zinc grey 0x8090a0,
    dark window 0x2a3040, plane tree green 0x4a6830)

7. CAMERA ANGLE
   Where does a tourist/visitor naturally stand when looking at this place?
   (e.g. Champs-Élysées: standing in the middle of the boulevard,
    looking toward the Arc de Triomphe; NOT looking at a blank wall)
   → Drives camera position and lookAt target.
```

After answering all 7 questions, map each answer to specific code:
- Question 1 → choose primitive (makeGateway / loadModel / makeKarstPeak / makeBuilding)
- Question 2 → choose layout type and dimensions
- Questions 3-4 → choose colors, textures, model URLs
- Question 5 → skybox preset, fog type, density, color
- Question 6 → hex values for all materials
- Question 7 → camera.position and controls.target

---

### Landmark geometry rules

| Landmark type | Correct primitive | NEVER use |
|---|---|---|
| Triumphal arch (Arc de Triomphe, Brandenburg Gate) | `stdlib.makeGateway({ archHeight, archWidth, ... })` | `makeBuilding()` (no arch opening) |
| Pagoda / tiered tower | stacked BoxGeometry tiers with shrinking footprints | a single extruded box |
| Dome (Capitol, Panthéon) | LatheGeometry with hemisphere profile | BoxGeometry |
| Bridge arch | `stdlib.makeGateway()` or custom ExtrudeGeometry | flat BoxGeometry |
| Obelisk (Washington Monument) | tall tapered BoxGeometry or CylinderGeometry | generic makeBuilding |
| Mosque minaret | CylinderGeometry + onion dome | makeBuilding |

---

### Reference Image Analysis Protocol

When the user provides reference photos, extract the following before generating. Each line maps directly to an stdlib call or atmosphere parameter.

```
1. Dominant element    → what occupies 40%+ of the frame? → becomes the anchor in Step 1
2. Terrain topology    → flat / slope / terraced / valley / cliff? → Step 2 terrain signature
3. Water presence      → none / stream / river (is it the center axis?) / coast?
4. Architecture        → material, roof form, building density, height profile
5. Atmosphere          → fog density (thick/thin/none), light direction, time of day, moisture
6. Color palette       → identify 4–5 dominant hex values by sampling the image mentally
7. Camera height       → eye-level / elevated / aerial?

Map: terrain → layout type | palette → fog + lighting hex | architecture → stdlib primitives
```

---

### Worked example: Champs-Élysées (correct approach)

**Research:**
1. Dominant anchor: Arc de Triomphe — 50m tall triumphal arch at western end
2. Layout: straight boulevard 1.8km long, 70m wide, camera looking west toward the Arc
3. Architecture: Haussmann 6-floor cream limestone, uniform ~22m cornice height, mansard zinc roofs
4. Vegetation: double rows of plane trees on both inner sidewalks, every 8m, height ~12-15m
5. Atmosphere: Paris overcast or clear, European light, no tropical fog
6. Palette: limestone 0xede8d8, zinc 0x8090a0, asphalt 0x3a3a40, tree green 0x4a6830
7. Camera: standing in boulevard looking west, eye level 1.7m, Arc visible at far end

**Code:**
```javascript
stdlib.setupLighting({ skybox: "overcast", hdri: true });
// No fog — Paris has clear air, fog would hide the Arc

const L = stdlib.useLayout("outdoor_street", { width: 70, depth: 180 });
L.buildBase();

// Arc de Triomphe — the focal object, not a box
stdlib.makeGateway({
  height: 50, width: 45, depth: 22,
  archHeight: 29, archWidth: 15,
  color: 0xede8d8,  // limestone cream
  position: { x: 0, y: 0, z: -85 },
});

// Haussmann buildings — uniform height, limestone
[-1, 1].forEach(side => {
  for (let z = -80; z < 20; z += 14) {
    stdlib.makeBuilding({
      width: 13, depth: 12, height: 22,
      color: 0xede8d8,
      position: { x: side * 48, y: 0, z },
    });
  }
});

// Double rows of plane trees on inner sidewalks
[-1, 1].forEach(side => {
  for (let z = -75; z < 15; z += 8) {
    stdlib.makeTree({ position: { x: side * 30, y: 0, z }, scale: 1.3 });
    stdlib.makeTree({ position: { x: side * 25, y: 0, z + 4 }, scale: 1.1 });
  }
});

// Camera: boulevard centerline, eye level, looking toward Arc
camera.position.set(0, 1.7, 18);
controls.target.set(0, 12, -85);
```
