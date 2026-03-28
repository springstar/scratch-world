# scratch-world Codemap

**Last Updated:** 2026-03-29

A chat-driven AI agent for creating and exploring persistent 3D worlds through natural conversation. The system integrates Claude (via pi-agent-core) with a Three.js viewer and pluggable 3D generation backends.

## Architecture Overview

```
User Message (Telegram/stdin)          Web Browser (Chat UI)
    ↓                                         ↓
Channel Gateway                        POST /chat  (Viewer API)
(normalizes to ChatMessage)                   ↓
    ↓                                  dispatchWebChat()
    └────────────┬────────────────────────────┘
                 ↓
         Session Manager (per-user state)
                 ↓
Agent Core (Claude + tools) ←→ Scene Manager ←→ 3D Provider (Marble/Stub/LLM)
    ↓                         ↓                      ↓
Tool Execution          Scene CRUD         If provider.startGeneration:
  - create_scene          ↓                  ├─ enqueue job to GenerationQueue
  - update_scene    SQLite/PostgreSQL        └─ scene.status = "generating"
  - get_scene             ↓                     scene.operationId = "..."
  - list_scenes    Viewer API (HTTP + WS)
  - navigate_to           ↓                  GenerationQueue
  - interact_with    Three.js Viewer        (polls every 3s until done)
  - share_scene     + SplatViewer               ↓
                   (scene-renderer.ts)    completeScene() / failScene()
                                                ↓
                                    WebSocket event: scene_created /
                                    scene_updated (with final status="ready")
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
| **Session Manager** | `src/session/session-manager.ts` | Maintains per-user state, dispatches to agent, injects active skills | `SessionManager` |
| **Agent Factory** | `src/agent/agent-factory.ts` | Wires Claude with scene tools | `createAgent()` |
| **Scene Tools** | `src/agent/tools/*.ts` | Tool implementations (create, update, get, list, navigate, interact, share) | Tool functions |
| **Scene Validator** | `src/agent/scene-validator.ts` | Static analysis of sceneCode before storage; catches spatial and code-quality violations so agent can self-correct | `validateSceneCode()`, `formatViolations()` |
| **Scene Manager** | `src/scene/scene-manager.ts` | Scene CRUD, orchestrates provider calls (sync and async), versioning | `SceneManager` |
| **Scene Types** | `src/scene/types.ts` | Core domain interfaces with async fields (Scene.status, operationId) | Type definitions |
| **Scene Schema** | `src/scene/schema.ts` | Typebox validation schemas for API | Schema validators |
| **Generation Queue** | `src/generation/generation-queue.ts` | Polls async providers every 3s, completes scenes or reports errors | `GenerationQueue` |
| **Marble Provider** | `src/providers/marble/provider.ts` | WorldLabs Marble 3D generation backend (supports async) | `MarbleProvider` |
| **LLM Provider** | `src/providers/llm/provider.ts` | Claude-based generation (supports async) | `LLMProvider` |
| **Splat Proxy Route** | `src/viewer-api/routes/splat-proxy.ts` | Proxy GET /splat/:sceneId to serve SPZ files with API key server-side | `splatProxyRoute()` |
| **Stub Provider** | `src/providers/stub/provider.ts` | Mock provider with static fixtures (local dev) | `StubProvider` |
| **Storage Repos** | `src/storage/*.ts` | Scene and Session persistence | `SceneRepository`, `SessionRepository` |
| **Viewer API** | `src/viewer-api/server.ts` | HTTP + WebSocket server for viewer and web chat | Hono app |
| **Chat Route** | `src/viewer-api/routes/chat.ts` | POST /chat endpoint for web UI | `chatRoute()` |
| **Scene Renderer** | `viewer/src/renderer/scene-renderer.ts` | Three.js WebGPU scene construction from SceneData; executes sceneCode sandbox; post-processing pipeline (bloom → SMAA → film grain → vignette) | `SceneRenderer` |
| **Scene Stdlib** | `viewer/src/renderer/scene-stdlib.ts` | Standard library injected into sceneCode sandbox as `stdlib`; lighting, terrain, buildings, NPCs, trees, layout | `createStdlib()`, `StdlibApi` |
| **Layout Solver** | `viewer/src/renderer/layout-solver.ts` | Semantic layout engine — AI declares scene type, solver computes all x/y/z positions for structural elements | `createLayout()`, `SceneLayout` |
| **Splat Viewer** | `viewer/src/components/SplatViewer.tsx` | Gaussian splat viewer using @sparkjsdev/spark | `SplatViewer` |
| **Viewer Canvas** | `viewer/src/components/ViewerCanvas.tsx` | React wrapper around Three.js renderer | UI component |
| **Chat Drawer** | `viewer/src/components/ChatDrawer.tsx` | Bottom sheet chat UI (peek/open states, streaming) | `ChatDrawer` |
| **Star Field** | `viewer/src/components/StarField.tsx` | Canvas 2D star particle background for empty state | `StarField` |

## Data Flow

### Creating a Scene via Web Chat

1. User opens browser at `http://localhost:5173` — sees StarField background + ChatDrawer peek strip
2. User types a message (e.g. "create a snowy mountain scene") and sends
3. **App.tsx** `POST /chat { sessionId: "web:<userId>", userId, text }`
4. **chat.ts** route calls `sessionManager.dispatchWebChat()` (fire-and-forget) and returns `{ ok: true }`
5. **dispatchWebChat** upserts session (creates if first visit), dispatches to Agent
6. **Agent** (Claude) receives message, calls `create_scene` tool
7. **Scene Manager** creates scene record, returns scene with `sceneId` + viewUrl
8. **dispatchWebChat** publishes `scene_created` WS event: `{ type, sceneId, title, viewUrl }`
9. **App.tsx** receives event: auto-loads scene via `loadSceneById()`, adds scene card to ChatDrawer
10. **ChatDrawer** shows scene card; clicking it navigates camera to first viewpoint

### Creating a Scene (Happy Path — Telegram)

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
5. **create-scene.ts** tool determines execution path:
   - **Skill path**: If sceneData merged from prompt-generator skill (Claude-only), calls `SceneManager.createScene()` synchronously
   - **Async provider path**: If provider has `startGeneration()` method (Marble/LLM):
     - Calls `provider.startGeneration(prompt)` → returns `operationId`
     - Calls `SceneManager.createSceneAsync()` → creates Scene with `status="generating"`, `operationId`
     - Enqueues job to `GenerationQueue` which polls every 3s via `provider.checkGeneration(operationId)`
     - When done, `GenerationQueue` calls `SceneManager.completeScene()` → `status="ready"`, broadcasts `scene_created` via WebSocket
   - **Sync fallback**: If no startGeneration (StubProvider), calls `SceneManager.createScene()` immediately
6. **Tool returns immediately** (for async path) with scene `{ sceneId, status: "generating" }`
7. **Channel Adapter** sends reply with viewer URL back to user
8. User opens viewer URL → scene loads with "generating" status indicator
9. **GenerationQueue** completes generation → broadcasts `scene_created` event → viewer updates to `status="ready"`, displays full scene

### Updating a Scene

1. User: `"Add a fountain to the center"`
2. **update-scene.ts** tool determines execution path (same three paths as create_scene):
   - **Skill path**: Synchronous SceneManager call
   - **Async provider path**: Calls `provider.startGeneration()`, enqueues to GenerationQueue
   - **Sync fallback**: Immediate provider call
3. For async path: Scene incremented to next version with `status="generating"`, operationId stored
4. **GenerationQueue** polls and eventually calls `SceneManager.completeScene()`
5. Scene status becomes `"ready"`, version incremented, broadcast via WebSocket
6. **Viewer API** broadcasts `scene_updated` event with new version
7. Viewer re-renders with updated scene

### Interacting with Objects

1. User navigates to a viewpoint and clicks/taps object in 3D scene
2. **scene-renderer.ts** uses raycasting to identify clicked object (`objectId`)
3. UI sends `POST /api/interact` with action (e.g., "examine the fountain")
4. **Viewer API** dispatches to Agent: `"I clicked on fountain, what happens?"`
5. **Agent** may call `update_scene` to change object state, return narrative description
6. UI updates scene state or displays text response

## Web Chat UI

The browser-native chat interface lives entirely in `viewer/src/`.

### Session Identity

- `userId`: UUID generated once and stored in `localStorage` key `scratch_world_user_id`
- `sessionId`: `"web:<userId>"` — matches session records in the DB
- `channelId`: `"web"` — set by `dispatchWebChat()` when upserting sessions

### Components

**`viewer/src/App.tsx`**
- Detects route: `/` (no scene, show StarField) vs `/scene/<id>` (load and render scene)
- Single WebSocket connection on mount, handles all event types
- `loadSceneById(id)`: fetches scene, sets `activeViewpoint` to first viewpoint, updates URL
- Passes `?session=web:<userId>` to all `fetchScene()` calls so owner access works without a share token

**`viewer/src/components/ChatDrawer.tsx`**
- Two states: `peek` (72px, shows last message preview) / `open` (52vh, full chat + input)
- Auto-opens when first message arrives
- User messages: right-aligned, purple background
- Agent messages: left-aligned, dark background; streaming messages show blinking cursor
- Typing indicator: bouncing dots while agent is processing
- Scene cards: rendered when `scene_created` event fires; clicking collapses drawer and navigates
- `renderText()`: parses `[text](url)` markdown link syntax into clickable `<a>` tags

**`viewer/src/components/StarField.tsx`**
- Canvas 2D with 220 twinkling star particles
- Radial gradient background (`#0a0a14` → `#000008`)
- ResizeObserver for responsive resizing; no WebGPU dependency

### Access Control for Scene Fetch

`GET /scenes/:sceneId` grants access when any of:
1. `scene.is_public === true`
2. `?session=web:<userId>` provided and `userId === scene.ownerId`
3. `?token=<shareToken>` provided and `shareToken === scene.shareToken`

Without one of the above, returns `403 Forbidden`.

## Scene Sharing

`share_scene` tool (in `src/agent/tools/share-scene.ts`):
- Generates a UUID share token (reuses existing token if already set)
- Calls `SceneManager.shareScene(sceneId)` which persists token to DB
- Returns a `shareUrl`: `<VIEWER_BASE_URL>/scene/<sceneId>?token=<token>`
- Users receiving the link can view the scene without owning it



**File**: `/Users/wuchunxin/agents/scratch-world/viewer/src/renderer/scene-renderer.ts`

### Core Functions

- **`loadScene(sceneData: SceneData)`** — Async; configures environment then executes sceneCode sandbox
  - Mutes renderer's built-in lights; all lighting is owned by `stdlib.setupLighting()`
  - Calls `executeCode()` then traverses `codeGroup` to force `castShadow=false` on all lights
  - Detects indoor scenes via `scene.userData["isIndoor"]` flag or presence of PointLights;
    applies tighter bloom (strength=0.12, radius=0.05, threshold=1.3) automatically

- **`executeCode(code: string)`** — Sandbox for sceneCode execution
  - Available globals: `THREE`, `tsl`, `scene`, `camera`, `renderer`, `controls`, `animate()`, `WaterMesh`, `stdlib`
  - `scene.add()` is proxied to `codeGroup` so all code-added objects are tracked and cleared on reload
  - `scene.background`, `scene.fog`, `scene.environment` still reach the real Scene object

- **`setupPostProcessing()`** — WebGPU PostProcessing pipeline (TSL node graph)
  - Pipeline: `bloom → SMAA → film grain → vignette`
  - Bloom defaults: strength=0.2, radius=0.2, threshold=1.1
  - Night scenes: bloom strength boosted to max(0.8, configured) automatically
  - Indoor scenes: overridden post-executeCode to strength=0.12, radius=0.05, threshold=1.3

- **`resolveEnvPreset(skybox?, timeOfDay?)`** — Environment preset lookup
  - Returns sky color, sun color/position/intensity, fog, ambient
  - Supports: clear_day, sunset, night, overcast, noon, dawn/dusk

### Validation–Correction Loop

All sceneCode passes through `scene-validator.ts` before storage:
1. `create_scene` / `update_scene` tools call `validateSceneCode(sceneCode)`
2. Violations returned in tool result JSON as `violations` field
3. Agent system prompt instructs immediate `update_scene` call to fix all errors before responding

### Semantic Layout System

`stdlib.useLayout(type, opts)` returns a `SceneLayout` (from `layout-solver.ts`):
- AI declares scene type (`"outdoor_soccer"`, `"indoor_arena"`, etc.); solver computes all positions
- `buildBase()` — full structural skeleton (ground + walls/boundary + background hills)
- `place(role)` — semantic placement (`"north_goal"`, `"bleachers_south"`, etc.) with solver-computed position
- `viewpoint(name?)` — safe camera positions (`"overview"`, `"sideline"`, `"end_zone"`, `"center"`)
- Hills and boundary elements are always placed outside `structureBounds` — impossible to overlap structures

### Gaussian Splat Rendering (SplatViewer)

When `sceneData.splatUrl` is present, the viewer routes to `SplatViewer` (using `@sparkjsdev/spark`):

- **Camera position**: `(0, 1.7, 0)` — placed inside the scene at eye height
- **Coordinate flip**: `splat.rotation.x = Math.PI` converts COLMAP convention (Y-down, Z-forward) to Three.js convention (Y-up, Z-backward)
- **OrbitControls**: target set to `(0, 1.7, 5)` for natural pan/zoom
- **WASD navigation**: full keyboard + arrow key support
- **Loading state**: animated progress bar with gradient background
- **Error handling**: displays error message overlay if splat fails to load

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
- `share_scene(sceneId)` → Generate share token, return `shareUrl` with `?token=` query param

## Viewer API

**Port**: 3001 (configurable via `VIEWER_API_PORT`)

### HTTP Endpoints

- `GET /scenes/:sceneId` — Fetch scene data (returns `SceneResponse`)
  - Access: `is_public=true` OR `?session=web:<userId>` (owner match) OR `?token=<shareToken>`
- `POST /scenes/:sceneId/panorama` — Upload or set equirectangular skybox URL
- `POST /interact` — Submit interaction (JSON body: `{ sceneId, objectId, action }`)
- `POST /chat` — Web chat endpoint (JSON body: `{ sessionId, userId, text }`) → returns `{ ok: true }`, streams via WS
- `GET /splat/:sceneId` — SPZ proxy: fetches Marble SPZ with API key server-side, streams to browser (see auth note below)
- `GET /` — Health check / serve viewer app

### ⚠️ CRITICAL: Marble SPZ Authentication

Marble's `spz_urls[]` (Gaussian splat files) require the `WLT-Api-Key` header.
**The API key must NEVER be sent to the browser.**

Two strategies are implemented (controlled by `SPZ_MODE` env var):

#### `SPZ_MODE=proxy` (default)
The backend route `GET /splat/:sceneId` fetches the SPZ from Marble's CDN with the
API key added server-side, then streams the binary to the browser without exposing the key.

```
Browser → GET /splat/<sceneId>
Backend → GET <spz_url> (with WLT-Api-Key header)
Backend → streams ArrayBuffer back to browser
```

- `spzUrls` stored in `scene.sceneData.objects[0].metadata.spzUrls`
  - Marble returns either `string[]` or `Record<string, string>` (e.g. `{500k, 100k, full_res}`)
  - Proxy route handles both formats: array → first element, object → prefers "500k" → "100k" → "full_res" → first available
- `sceneData.splatUrl` is set to `/splat/<sceneId>` after scene ID assignment
- Response cached for 1 hour via `Cache-Control`

#### `SPZ_MODE=local`
At generation time the provider downloads `spz_urls[0]` with the API key and saves it to
`uploads/splats/<worldId>.spz`. The static file server at `/uploads/*` serves it directly.

```
MarbleProvider.generate() → downloads SPZ → uploads/splats/<worldId>.spz
Browser → GET /uploads/splats/<worldId>.spz (no auth needed)
```

- Falls back to `proxy` mode automatically if the download fails.
- Pros: served without repeated CDN round-trips; survives Marble CDN URL expiry.
- Cons: consumes local disk space; increases generation time for large scenes.

#### Viewer routing (App.tsx)
```
sceneData.splatUrl present        → SplatViewer (Gaussian splat, @sparkjsdev/spark)
providerRef.provider === "marble" → MarbleViewer (iframe, legacy)
else                              → ViewerCanvas (Three.js WebGPU renderer)
```

### WebSocket

- Connection: `ws://localhost:3001/realtime/:sessionId`
- Per-session connection; broadcasts real-time events to the connected viewer

### WebSocket Event Types

```typescript
type RealtimeEvent =
  | { type: "text_delta"; delta: string }           // Streaming agent text chunk
  | { type: "text_done"; text: string }             // Agent response complete
  | { type: "scene_created"; sceneId: string; title: string; viewUrl: string }  // New scene from web chat
  | { type: "scene_updated"; sceneId: string; version: number }  // Existing scene modified (async or sync)
  | { type: "error"; message: string }              // Error during processing
```

## Storage Schema

**Supported backends**: SQLite (dev), PostgreSQL (prod)

### Schemas (defined in `src/storage/`)

- **scenes** — Main scene table
  - `sceneId` (PK), `ownerId`, `title`, `description`, `sceneData` (JSON), `providerRef` (JSON), `version`, `createdAt`, `updatedAt`
  - `is_public` (INTEGER, default 0) — whether scene is publicly accessible without auth
  - `share_token` (TEXT, UNIQUE) — opaque token for share-by-link access
  - `status` (TEXT) — `"generating"`, `"ready"`, or `"failed"` (async lifecycle)
  - `operationId` (TEXT) — provider operationId while status is `"generating"`

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
| `SPZ_MODE` | `proxy` | `proxy` (stream via /splat/:sceneId) or `local` (cache to uploads/splats/) — see auth note above |
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
