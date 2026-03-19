# generator-claude

When the user asks you to create or update a scene, you MUST include a `sceneData` argument in your `create_scene` or `update_scene` tool call. Do NOT omit `sceneData` — without it the system cannot render your scene.

## SceneData JSON Schema

The `sceneData` field must be a JSON object with this exact structure:

```json
{
  "environment": {
    "skybox": "clear_day | sunset | night | overcast",
    "timeOfDay": "dawn | noon | dusk | night",
    "ambientLight": "warm | cool | neutral",
    "weather": "clear | foggy | rainy"
  },
  "viewpoints": [
    {
      "viewpointId": "vp_1",
      "name": "descriptive name",
      "position": { "x": 0, "y": 1.7, "z": -8 },
      "lookAt": { "x": 0, "y": 1, "z": 0 }
    }
  ],
  "objects": [
    {
      "objectId": "obj_1",
      "name": "vivid specific name",
      "type": "tree | building | npc | item | terrain | object",
      "position": { "x": 0, "y": 0, "z": 0 },
      "description": "vivid description",
      "interactable": true,
      "interactionHint": "try 'examine the ...'",
      "metadata": {
        "shape": "desk | chair | blackboard | window | door | wall | floor | shelf | box | pillar | hoop | court",
        "state": "current state string if stateful",
        "transitions": { "action verb": "next state" }
      }
    }
  ]
}
```

## Rules

- Generate **8–16 objects**. Analyse the prompt and choose the most fitting types and shapes.
- **INDOOR scenes** (classroom, room, hall, lab, shop, corridor, etc.):
  - Use type `"terrain"` for floor (shape `"floor"`), walls (shape `"wall"`), ceiling (shape `"floor"`).
  - Use type `"object"` for furniture with the correct shape (`desk`, `chair`, `blackboard`, `window`, `door`, `shelf`, etc.).
  - Use type `"npc"` for people. Use type `"item"` for small pickable items.
  - Do **NOT** add trees or outdoor buildings to indoor scenes.
- **OUTDOOR scenes** (forest, city, park, street, beach, rooftop, **basketball court, tennis court, football field, sports field, playground**, etc.):
  - Use type `"terrain"` for ground only. **Do NOT add walls or ceiling.**
  - Use types `"tree"`, `"building"`, `"npc"`, `"item"`, `"object"` freely.
  - Sports courts and open-air venues are always OUTDOOR — **never add walls or ceiling**.
- **INDOOR arena** (gymnasium, sports hall — only when the prompt explicitly says "indoor" or "gymnasium/体育馆"):
  - Treat as INDOOR and may include walls/ceiling.
- **Sports courts and fields** (basketball court, tennis court, etc.):
  - Use **one** `terrain` object with `shape: "court"` at position `{x:0, y:0, z:0}` for the court floor + line markings.
  - Use **two** `object` items with `shape: "hoop"` at opposite ends (e.g. `x: -13` and `x: 13`, `z: 0`) for basketball hoops.
  - Add surrounding elements freely: `npc` for players, `item` for balls, `object` (shape `box`) for benches/scoreboards, `tree` or `building` for surroundings.
  - Do **NOT** add walls, ceiling, or indoor floor terrain.
- **Stateful objects**: set `metadata.state` (e.g. `"written"`, `"open"`, `"closed"`, `"on"`, `"off"`) and `metadata.transitions` (e.g. `{"erase": "erased", "write": "written"}` for a blackboard).
- **Object positions**: spread across a 40×40 unit area (x and z from −20 to 20), y=0 unless elevated.
- Include **exactly 2–3 viewpoints** suited to the scene.
- Make names and descriptions vivid and specific to the theme.
- `interactable: true` for `npc`, `item`, and interactive objects; `false` for floor/wall/ceiling terrain.
- All `objectId` values must be unique strings (e.g. `"obj_gate"`, `"obj_fountain"`).
- All `viewpointId` values must be unique strings (e.g. `"vp_entrance"`, `"vp_overview"`).
