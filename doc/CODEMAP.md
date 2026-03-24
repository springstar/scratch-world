# scratch-world Codemap

**Last Updated:** 2026-03-22

A chat-driven AI agent for creating and exploring persistent 3D worlds through natural conversation. The system integrates Claude (via pi-agent-core) with a Three.js viewer and pluggable 3D generation backends.

## Architecture Overview

```
User Message (Telegram/stdin)
    ↓
Channel Gateway (normalizes to ChatMessage)
    ↓
Session Manager (per-user state)
    ↓
Agent Core (Claude + tools) ←→ Scene Manager ←→ 3D Provider (Marble/Stub)
    ↓                              ↓
Tool Execution                 Scene CRUD
  - create_scene                  ↓
  - update_scene            SQLite/PostgreSQL
  - get_scene                   ↓
  - list_scenes         Viewer API (HTTP + WebSocket)
  - navigate_to                  ↓
  - interact_with           Three.js Viewer
                            (scene-renderer.ts)
```

## Entry Points

- **Backend**: `/Users/wuchunxin/agents/scratch-world/src/index.ts` — wires all components, starts gateway and viewer API
- **Viewer**: `/Users/wuchunxin/agents/scratch-world/viewer/src/components/ViewerCanvas.tsx` — React component that loads scenes and renders via Three.js
- **Renderer**: `/Users/wuchunxin/agents/scratch-world/viewer/src/renderer/scene-renderer.ts` — Three.js rendering engine for SceneData → 3D objects

## Key Modules

| Module | Location | Purpose | Key Exports |
|--------|----------|---------|-------------|
| **Channel Gateway** | `src/channels/gateway.ts` | Routes messages from adapters to sessions | `ChannelGateway` |
| **Telegram Adapter** | `src/channels/telegram/adapter.ts` | Telegram bot integration | `TelegramAdapter` |
| **Session Manager** | `src/session/session-manager.ts` | Maintains per-user state, dispatches to agent | `SessionManager` |
| **Agent Factory** | `src/agent/agent-factory.ts` | Wires Claude with scene tools | `createAgent()` |
| **Scene Tools** | `src/agent/tools/*.ts` | Tool implementations (create, update, get, list, navigate, interact) | Tool functions |
| **Scene Manager** | `src/scene/scene-manager.ts` | Scene CRUD, orchestrates provider calls | `SceneManager` |
| **Scene Types** | `src/scene/types.ts` | Core domain interfaces (Scene, SceneData, SceneObject, etc.) | Type definitions |
| **Scene Schema** | `src/scene/schema.ts` | Typebox validation schemas for API | Schema validators |
| **Marble Provider** | `src/providers/marble/provider.ts` | WorldLabs Marble 3D generation backend | `MarbleProvider` |
| **Stub Provider** | `src/providers/stub/provider.ts` | Mock provider with static fixtures (local dev) | `StubProvider` |
| **Storage Repos** | `src/storage/*.ts` | Scene and Session persistence | `SceneRepository`, `SessionRepository` |
| **Viewer API** | `src/viewer-api/viewer-server.ts` | HTTP + WebSocket server for viewer | Express + Socket.io |
| **Scene Renderer** | `viewer/src/renderer/scene-renderer.ts` | Three.js scene construction from SceneData | `loadScene()`, `renderScene()` |
| **Viewer Canvas** | `viewer/src/components/ViewerCanvas.tsx` | React wrapper around Three.js renderer | UI component |

## Data Flow

### Creating a Scene (Happy Path)

1. User types in Telegram or stdin: `"Create a basketball court"`
2. **Channel Adapter** normalizes to `ChatMessage`
3. **Session Manager** loads or creates session, routes to agent
4. **Agent** (Claude) receives message, calls `create_scene` tool with:
   ```typescript
   {
     prompt: "Create a basketball court",
     sceneData?: { objects: [...], environment: {...}, viewpoints: [...] }
   }
   ```
5. **create-scene.ts** tool:
   - Merges `sceneCode` (if provided) into `sceneData`
   - Calls `SceneManager.createScene(userId, prompt, title, sceneData)`
6. **SceneManager**:
   - Generates GLTF asset via 3D provider (Marble or Stub)
   - Creates `Scene` record in database
   - Returns scene with `providerRef` (asset ID) and viewer URL
7. **Tool** returns scene details to Claude as text
8. **Channel Adapter** sends reply with viewer URL back to user
9. User opens viewer URL → browser loads `viewer/src/components/App.tsx` → `ViewerCanvas.tsx`
10. **ViewerCanvas** fetches scene via `GET /api/scenes/:sceneId`
11. **scene-renderer.ts** parses `sceneData` and builds Three.js scene:
    - Builds procedurally generated objects from `SceneObject[]`
    - Sets up lighting, sky, environment based on `EnvironmentConfig`
    - Applies bloom post-processing if configured
    - Loads GLTF models if `metadata.modelUrl` present
    - Registers viewpoint cameras
12. User sees 3D scene in browser, can navigate and interact

### Updating a Scene

1. User: `"Add a fountain to the center"`
2. **update-scene.ts** tool calls `SceneManager.updateScene(sceneId, instruction, sceneData?)`
3. **SceneManager**:
   - Fetches current scene
   - Increments version
   - Writes snapshot to `scene_versions` table
   - Sends edit instruction to 3D provider
   - Updates database, returns new scene
4. **Viewer API** broadcasts real-time update via WebSocket to all connected clients
5. Viewer re-renders with updated scene

### Interacting with Objects

1. User navigates to a viewpoint and clicks/taps object in 3D scene
2. **scene-renderer.ts** uses raycasting to identify clicked object (`objectId`)
3. UI sends `POST /api/interact` with action (e.g., "examine the fountain")
4. **Viewer API** dispatches to Agent: `"I clicked on fountain, what happens?"`
5. **Agent** may call `update_scene` to change object state, return narrative description
6. UI updates scene state or displays text response

## Three.js Rendering Pipeline

**File**: `/Users/wuchunxin/agents/scratch-world/viewer/src/renderer/scene-renderer.ts`

### Core Functions

- **`loadScene(sceneData: SceneData)`** — Async; parses SceneData and populates Three.js scene
  - If `sceneData.sceneCode` present: calls `executeCode()` sandbox instead
  - Otherwise: iterates `sceneData.objects`, calls `buildObject()` for each
  - Configures environment (sky, lighting, fog) via `resolveEnvPreset()`
  - Detects indoor scenes (ceiling object present): adjusts fog, sun, ambient, bloom radius
  - Initialises LOD visibility on load (all levels start visible=true; init sets correct one)

- **`buildSceneObject(obj: SceneObject)`** — Returns THREE.Object3D for one object
  - Delegates to `buildGeometry()` for base shape
  - If `metadata.modelUrl` present: loads GLTF model asynchronously, replaces base
  - If stateful object: renders state-specific visuals (e.g., blackboard with/without chalk)
  - Applies user data and interaction data

- **`buildGeometry(type, shape, metadata)`** — Creates base mesh (fallback if model fails)
  - Handles all 15+ supported shapes: desk, chair, blackboard, window, door, shelf, pillar, hoop, court, floor, wall, ceiling, etc.
  - Uses PBR materials (MeshStandardMaterial) with color palette
  - Applies shadows and scale variations

- **`resolveEnvPreset(skybox?, timeOfDay?)`** — Looks up environment preset
  - Returns `EnvPreset`: sky color, sun color/position/intensity, fog, ambient light
  - Supports: clear_day, sunset, night, overcast
  - Supports timeOfDay: dawn, noon, dusk, night

- **`setupPostProcessing()`** — Initializes WebGPU PostProcessing + BloomNode (TSL)
  - Bloom configurable via `environment.effects.bloom` (strength, radius, threshold)
  - Bloom threshold clamped to minimum 1.5 in linear HDR space — prevents ordinary lit
    surfaces (walls, floors) from triggering bloom; only emissive lights (intensity ≥ 2) glow
  - Indoor scenes (detected by presence of ceiling object): bloom radius 0.12, sun at 5%,
    fog pushed to 300–600 u, ambient reduced 70% — prevents the "glowing scene box" effect

- **`executeCode(code: string, sandbox: SandboxContext)`** — Sandbox for custom code
  - Available: THREE, tsl, scene, camera, renderer, controls, animate(), WaterMesh
  - Used for particle systems, custom animations, procedural geometry
  - No network access, no DOM manipulation
  - **Pitfall**: never use `scene.traverse()` with loose color-channel filters to collect
    animated meshes — gold/stone/marble colors can match flame heuristics, causing unintended
    objects to animate. Tag meshes explicitly: `mesh.userData.animated = true`, then collect
    with `scene.traverse(obj => { if (obj.userData.animated) ... })`

### Demand Rendering and OrbitControls

The renderer uses a demand-render loop (`setAnimationLoop` + `framesDue` counter). Key invariants:

- `controls.update()` is **not** called unconditionally every frame. It runs only during:
  1. Active viewpoint transitions (syncs spherical state to lerped camera position)
  2. After user interaction (`controlsNeedsUpdate = true` set by OrbitControls `"start"` event),
     until `controls.update()` returns `false` (damping fully settled)
- Calling `controls.update()` every frame in a demand-render loop causes floating-point damping
  residual to accumulate, producing continuous slow camera drift with no user input.

### LOD System

Buildings use `THREE.LOD` with 3 detail levels (full / medium / low at 0 / 20 / 50 u).

- **`lod.autoUpdate = false`** is set on every LOD object — the WebGPU renderer's built-in
  `lod.update()` call is disabled. Our custom hysteresis system in `registerSystem(400, ...)`
  is the sole authority on level switching.
- Without `autoUpdate = false`, the renderer and our hysteresis system fight each other every
  frame, causing all three detail levels to flicker simultaneously — the "shaking buildings" bug.
- LOD visibility is also initialised immediately in `loadScene()` because Three.js creates all
  levels as `visible=true` by default.

### Object Type and Shape Mapping

```
type: "terrain"
  - shape: "floor" → 20×20 flat panel
  - shape: "wall" → 8×3 vertical slab, rotated
  - shape: "ceiling" → 20×20 flat panel (like floor)
  - shape: "court" → Basketball court with center line, 3-point arcs, key areas (procedural lines)

type: "object"
  - shape: desk/table → Box top + 4 cylindrical legs
  - shape: chair → Capsule body with seat/back geometry
  - shape: blackboard → Box board with optional chalk writing plane
  - shape: window → Box frame with transparent glass
  - shape: door → Box panel
  - shape: shelf/bookcase → Tall box unit
  - shape: pillar/column → Cylinder
  - shape: hoop → Pole + arm + backboard + rim + net; auto-mirrored for opposite end
  - shape: box → Fallback generic box

type: "tree" → Procedural: trunk + conical foliage, scale ±15%, random rotation
type: "building" → Box body + pyramid roof, random rotation
type: "npc" → Capsule-shaped figure
type: "item" → Cylinder
```

### Post-Processing (Path B: Bloom)

```typescript
// EffectComposer chain:
EffectComposer(renderer)
  .addPass(RenderPass(scene, camera))
  .addPass(UnrealBloomPass(strength=0.4, radius=0.3, threshold=0.85))
  .addPass(OutputPass())
```

- Always active, configurable per-scene
- Night scenes auto-apply strength=0.8 minimum
- Objects with emissive materials (neon, glow) benefit most

### GLTF Model Loading (Path A)

```typescript
// In buildSceneObject(), if metadata.modelUrl present:
const gltfLoader = new GLTFLoader();
gltfLoader.load(modelUrl, (gltf) => {
  const model = gltf.scene;
  model.scale.setScalar(metadata.scale ?? 1);
  model.position.y += metadata.yOffset ?? 0;
  group.remove(placeholder); // remove fallback geometry
  group.add(model);
});
```

- Placeholder primitive shown while loading
- On error: placeholder remains, console warning logged
- Free asset sources: Kenney.nl, Quaternius, KhronosGroup glTF Sample Assets, Three.js examples

### Code Generation (Path C: sceneCode)

When `SceneData.sceneCode` is present:

```typescript
const sandbox = { THREE, scene, camera, renderer, controls, animate };
const fn = new Function('THREE', 'scene', 'camera', 'renderer', 'controls', 'animate', sceneCode);
fn(...Object.values(sandbox));
```

- Full Three.js control: particle systems, custom shaders, procedural geometry
- `animate(cb: (delta: number) => void)` registers per-frame callbacks
- Sandboxed: no network, no DOM, only Three.js API

## Scene Schema

**File**: `/Users/wuchunxin/agents/scratch-world/src/scene/schema.ts`

```typescript
SceneData = {
  objects: SceneObject[],           // 8-16 recommended
  environment: EnvironmentConfig,
  viewpoints: Viewpoint[],          // 2-3 per scene
  sceneCode?: string                // Optional custom Three.js code
}

SceneObject = {
  objectId: string,                 // Unique per scene
  name: string,                     // Vivid description
  type: "tree" | "building" | "npc" | "item" | "terrain" | "object",
  position: { x, y, z },            // Spread within ±20 on x,z; y=0 unless elevated
  description: string,              // UI / LLM context
  interactable: boolean,
  interactionHint?: string,         // "try 'examine the...'"
  metadata: {
    shape?: string,                 // Suggests procedural shape (desk, chair, etc.)
    state?: string,                 // Stateful objects: "written", "open", "closed"
    transitions?: { action → nextState }, // Allowed state changes
    modelUrl?: string,              // GLTF/GLB URL
    scale?: number,                 // Model scale (default 1)
    yOffset?: number                // Model vertical offset (default 0)
  }
}

EnvironmentConfig = {
  skybox?: "clear_day" | "sunset" | "night" | "overcast",
  timeOfDay?: "dawn" | "noon" | "dusk" | "night",
  ambientLight?: string,
  weather?: "clear" | "foggy" | "rainy",
  effects?: {
    bloom?: { strength?: number, radius?: number, threshold?: number }
  }
}
```

## Agent Tool Parameters

### create_scene

```typescript
{
  prompt: string,              // "Create a basketball court"
  title?: string,              // Short title (max 60 chars)
  sceneData?: SceneData,       // Optional pre-built scene data
  sceneCode?: string           // Optional custom Three.js code
}
```

### update_scene

```typescript
{
  sceneId: string,
  instruction: string,         // "Add a fountain to the center"
  sceneData?: SceneData,
  sceneCode?: string
}
```

### Other tools

- `get_scene(sceneId)` → Scene metadata + SceneData
- `list_scenes(limit?, offset?)` → Paginated list of user's scenes
- `navigate_to(sceneId, viewpointId)` → Navigate to viewpoint, return view description
- `interact_with_object(sceneId, objectId, action)` → Execute action on object, return result

## Viewer API

**Port**: 3001 (configurable via `VIEWER_API_PORT`)

### HTTP Endpoints

- `GET /scenes/:sceneId` — Fetch scene data (returns `SceneResponse`)
- `POST /interact` — Submit interaction (JSON body: `{ sceneId, objectId, action }`)
- `GET /` — Health check / serve viewer app

### WebSocket

- Connection: `ws://localhost:3001` (or `VIEWER_BASE_URL` with `ws://` substituted)
- Broadcasts real-time updates to all connected viewers (scene updates, agent responses)

## Storage Schema

**Supported backends**: SQLite (dev), PostgreSQL (prod)

### Schemas (defined in `src/storage/`)

- **scenes** — Main scene table
  - `sceneId` (PK), `ownerId`, `title`, `description`, `sceneData` (JSON), `providerRef` (JSON), `version`, `createdAt`, `updatedAt`

- **sessions** — Session state persistence
  - `sessionId` (PK), `userId`, `channelId`, `agentState` (JSON), `activeSceneId` (FK), `createdAt`, `updatedAt`

- **scene_versions** — Immutable snapshots (future feature)
  - `sceneId` (FK), `version`, `sceneData` (JSON), `providerRef` (JSON), `createdAt`

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHANNEL` | `telegram` | `telegram` or `stdin` |
| `TELEGRAM_BOT_TOKEN` | — | Required when `CHANNEL=telegram` |
| `ANTHROPIC_API_KEY` | — | Claude API key |
| `ANTHROPIC_BASE_URL` | — | Optional proxy URL |
| `SCENE_PROVIDER` | `stub` | `marble`, `llm`, or `stub` |
| `MARBLE_API_KEY` | — | Required when `PROVIDER=marble` |
| `MARBLE_API_URL` | — | Marble endpoint (if custom) |
| `DATABASE_URL` | `sqlite:./dev.db` | `sqlite:<path>` or `postgres://...` |
| `VIEWER_API_PORT` | `3001` | Viewer API listen port |
| `VIEWER_BASE_URL` | `http://localhost:5173` | Public URL for viewer links |
| `AGENT_MAX_TURNS` | `20` | Max conversation turns kept in context |

## Dependencies

### Backend (npm)

| Package | Version | Purpose |
|---------|---------|---------|
| `@mariozechner/pi-agent-core` | Latest | Agent orchestration + tool calling |
| `anthropic` | Latest | Claude API client |
| `telegraf` | Latest | Telegram bot integration |
| `sqlite3` | Latest | SQLite driver (optional) |
| `pg` | Latest | PostgreSQL driver (optional) |
| `express` | Latest | HTTP server for viewer API |
| `socket.io` | Latest | WebSocket for real-time updates |
| `zod` | Latest | Runtime schema validation |
| `@sinclair/typebox` | Latest | JSON Schema + TypeScript integration |

### Viewer (npm)

| Package | Version | Purpose |
|---------|---------|---------|
| `three` | Latest | 3D rendering library |
| `react` | Latest | UI framework |
| `vite` | Latest | Build tool |

## Related Documents

- **doc/architecture.md** — Detailed system design with diagrams
- **doc/renderer.md** — Three.js 渲染器设计与实现（完整渲染管线、材质系统、动画、后期处理）
- **doc/interactions.md** — Interaction system design and future enhancements
- **doc/debug-log.md** — Startup issues and troubleshooting
- **CLAUDE.md** — Project conventions for Claude Code
- **src/skills/built-in/renderer-threejs/SKILL.md** — Three.js rendering capabilities reference
- **src/skills/built-in/generator-claude/SKILL.md** — Scene generation guidelines for Claude
