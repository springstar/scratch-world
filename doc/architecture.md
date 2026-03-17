# Architecture: Chat-Driven Open 3D World

## Overview

A chat-driven AI agent application that lets users create, explore, and evolve persistent 3D worlds through natural conversation. Supports multiple messaging channels (Telegram MVP, then WeChat, Discord, WhatsApp) and abstracts the 3D generation backend so providers like WorldLabs Marble can be swapped.

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Messaging Channels                        │
│   Telegram │ Discord │ WhatsApp │ WeChat │ (future channels...)  │
└─────────────────┬───────────────────────────────────────────────┘
                  │ normalized ChatMessage
┌─────────────────▼───────────────────────────────────────────────┐
│                       Channel Gateway                            │
│  - Normalize inbound messages to ChatMessage                     │
│  - Route replies back to the correct channel adapter             │
│  - One adapter per channel (pluggable interface)                 │
└─────────────────┬───────────────────────────────────────────────┘
                  │ ChatMessage { userId, channelId, text, media? }
┌─────────────────▼───────────────────────────────────────────────┐
│                      Session Manager                             │
│  - Lookup or create Session per (userId, channelId)              │
│  - Load/save AgentState + SceneState from storage                │
│  - Dispatch message to the user's Agent instance                 │
└────────┬────────────────────────────────────┬────────────────────┘
         │                                    │
┌────────▼────────────┐            ┌──────────▼──────────────────┐
│   Agent Core        │            │     Scene Manager            │
│  (pi-agent-core)    │◄──tools───►│  - Scene CRUD                │
│                     │            │  - Object management         │
│  - systemPrompt     │            │  - Navigation state          │
│  - message history  │            │  - Interaction state         │
│  - tool execution   │            │  - Serialization / diff      │
│  - event streaming  │            └──────────┬───────────────────┘
└─────────────────────┘                       │
                                   ┌──────────▼───────────────────┐
                                   │   3D Provider Interface       │
                                   │  (abstract / pluggable)       │
                                   │                               │
                                   │  Implementations:             │
                                   │   • MarbleProvider (MVP)      │
                                   │   • StubProvider (local dev)  │
                                   │   • Future providers...       │
                                   └──────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         Storage Layer                            │
│   scenes table  │  sessions table  │  scene_versions table      │
│   (PostgreSQL or SQLite for local dev)                           │
└─────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────────────────────────────┐
                    │               Viewer Layer                    │
                    │                                               │
                    │  ┌─────────────────┐   ┌──────────────────┐  │
                    │  │   Viewer API    │   │   Viewer App     │  │
                    │  │  (HTTP + WS)    │◄──│  (Three.js /     │  │
                    │  │                 │   │   Babylon.js)    │  │
                    │  │ GET /scenes/:id │   │                  │  │
                    │  │ POST /interact  │   │  - 渲染 3D 场景   │  │
                    │  │ WS  /realtime   │──►│  - 导航 / 交互    │  │
                    │  └────────┬────────┘   └──────────────────┘  │
                    │           │                                   │
                    │  每个 Channel Adapter 以平台原生方式打开 viewer │
                    └──────────────────────────────────────────────┘
```

---

## Core Concepts

### ChatMessage (channel-normalized)

```typescript
interface ChatMessage {
  userId: string;       // stable user ID within the channel
  channelId: string;    // e.g. "telegram", "discord"
  sessionId: string;    // userId + channelId composite
  text: string;
  media?: MediaAttachment[];
  timestamp: number;
}
```

### Session

Each `(userId, channelId)` pair owns one persistent session:

```typescript
interface Session {
  sessionId: string;
  userId: string;
  channelId: string;
  agentState: AgentState;       // pi-agent-core state (messages, model, tools)
  activeSceneId: string | null; // currently loaded scene
  createdAt: number;
  updatedAt: number;
}
```

### Scene

The central domain object. Persisted independently of sessions so a user can reference scenes across conversations.

```typescript
interface Scene {
  sceneId: string;
  ownerId: string;
  title: string;
  description: string;          // human-readable summary
  sceneData: SceneData;         // provider-agnostic representation
  providerRef: ProviderRef;     // opaque handle back to the 3D provider
  version: number;              // incremented on every update
  createdAt: number;
  updatedAt: number;
}

interface SceneData {
  objects: SceneObject[];
  environment: EnvironmentConfig;
  viewpoints: Viewpoint[];      // named camera positions for "navigate to X"
}

interface SceneObject {
  objectId: string;
  name: string;
  type: string;                 // "building", "tree", "npc", etc.
  position: Vec3;
  description: string;
  interactable: boolean;
  interactionScript?: string;   // future: NPC dialogue, puzzle logic
  metadata: Record<string, unknown>;
}
```

### ProviderRef

Opaque per-provider pointer to the generated asset:

```typescript
interface ProviderRef {
  provider: string;             // "marble" | "stub" | ...
  assetId: string;              // provider-internal ID
  viewUrl?: string;             // URL to view/embed the scene
  editToken?: string;           // token for incremental edits (if provider supports)
}
```

---

## Layer Details

### 1. Channel Adapters

Each adapter implements a single interface:

```typescript
interface ChannelAdapter {
  channelId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: ChatMessage) => Promise<void>): void;
  sendText(userId: string, text: string): Promise<void>;
  sendMedia(userId: string, media: OutboundMedia): Promise<void>;

  // Present a scene to the user in the channel's native way
  presentScene(userId: string, scene: Scene, viewerUrl: string): Promise<void>;
}
```

`presentScene()` is the extension point for the viewer layer. Each adapter implements it differently:

| Channel | Implementation |
|---|---|
| Telegram | `sendMessage` + `InlineKeyboardButton { web_app: { url: viewerUrl } }` — opens viewer fullscreen inside Telegram |
| WeChat | WeChat Mini Program webview card, or H5 link opened in WeChat's built-in browser |
| WhatsApp | Plain text URL — user taps to open in the system browser (no in-app embedding) |
| Discord | URL link (Discord Embedded App / Activities requires separate approval) |

MVP: `TelegramAdapter` using `grammy`.

### 2. Channel Gateway

- Starts all registered adapters
- Normalizes incoming messages to `ChatMessage`
- Calls `SessionManager.dispatch(msg)`
- Routes reply back to the originating adapter

### 3. Session Manager

- Loads `Session` from storage (or creates new)
- Instantiates or retrieves a cached `Agent` (pi-agent-core) per session
- Calls `agent.prompt(text)` and subscribes to events
- Streams text deltas back to the channel in real time
- Persists updated session state after each turn

### 4. Agent Core (pi-agent-core)

The agent holds:
- `systemPrompt` — world-building persona + tool usage instructions
- Conversation history (`messages`)
- A fixed set of **scene tools** (see below)
- Model config (default: Claude Sonnet)

The agent interprets user intent and decides which tools to call. It does **not** call the 3D provider directly — that is delegated to the Scene Manager via tools.

### 5. Scene Tools (agent tools)

```
create_scene(prompt, title)          → Scene
update_scene(sceneId, instruction)   → Scene
get_scene(sceneId)                   → Scene
list_scenes()                        → Scene[]
navigate_to(sceneId, viewpoint)      → NavigationResult
interact_with_object(sceneId, objectId, action) → InteractionResult
```

Each tool is an `AgentTool` (pi-agent-core format) that calls the Scene Manager.

### 6. Scene Manager

Coordinates between the agent tools and the 3D provider:

- `createScene(prompt)` — calls `Provider.generate(prompt)`, stores result
- `updateScene(sceneId, instruction)` — calls `Provider.edit(providerRef, instruction)`, versions the scene
- `navigateTo(sceneId, viewpoint)` — resolves named viewpoint, returns view URL or embed data
- `interactWith(objectId, action)` — dispatches to the object's interaction handler

Versioning: every mutation increments `scene.version` and stores a snapshot, enabling rollback.

### 7. 3D Provider Interface

```typescript
interface ThreeDProvider {
  name: string;

  // Generate a new scene from a text prompt
  generate(prompt: string, options?: GenerateOptions): Promise<ProviderResult>;

  // Incrementally edit an existing scene
  edit(ref: ProviderRef, instruction: string, options?: EditOptions): Promise<ProviderResult>;

  // Retrieve current state (for sync after external edits)
  describe(ref: ProviderRef): Promise<ProviderDescription>;
}

interface ProviderResult {
  ref: ProviderRef;
  viewUrl: string;        // shareable link the bot sends back to the user
  thumbnailUrl?: string;
  sceneData: SceneData;   // parsed, provider-agnostic scene graph
}
```

`MarbleProvider` implements this against the WorldLabs Marble API.
`StubProvider` returns static fixtures for local development without API keys.

---

## Viewer Layer

The viewer layer is responsible for rendering the 3D scene and routing user interactions (navigation, object clicks) back into the agent loop.

### Why a separate viewer layer

Chat channels cannot render 3D content natively. The viewer is a web application that loads scene data from the Viewer API and renders it. Each channel adapter opens the viewer in the most native way available for that platform.

### 8. Viewer API

A lightweight HTTP + WebSocket server that sits between the Viewer App and the rest of the backend.

```
Endpoints:

GET  /scenes/:sceneId          → SceneData (for the viewer to render)
POST /interact                 → { sessionId, sceneId, objectId, action }
                                 dispatches to SessionManager, returns narrative outcome
WS   /realtime/:sessionId      → server-push for LLM text deltas and scene state changes
```

The Viewer API reuses `SceneManager` and `SessionManager` directly — no duplication of business logic.

### 9. Viewer App

A single-page web application, platform-agnostic. Opened by the channel adapter after a scene is created or updated.

**Stack (MVP):** Vite + React + Three.js (or Babylon.js)

**Responsibilities:**
- Load `SceneData` from Viewer API on mount
- Render the 3D scene (objects, environment, camera positions)
- Handle user navigation (click viewpoint, WASD/touch movement)
- Handle object interaction (click object → `POST /interact` → display narrative outcome)
- Receive real-time updates via WebSocket (LLM reply text, scene mutations)

**Telegram-specific:** When running inside a Telegram Web App, the viewer can use `window.Telegram.WebApp.sendData()` to send interaction results directly back to the bot, bypassing the Viewer API round-trip.

### Viewer interaction flow

```
User clicks object in Viewer App
  → POST /interact { sessionId, sceneId, objectId, action: "examine" }
    → Viewer API → SessionManager.dispatch()
      → Agent.prompt("examine <object>")
        → interact_with_object tool → SceneManager
          → InteractionResult { outcome: "The chest creaks open..." }
        → LLM generates narrative reply
      → text deltas pushed via WebSocket
        → Viewer App displays narrative in overlay
```

### Per-channel viewer launch

After `create_scene` or `update_scene` completes, `SessionManager` calls:

```typescript
adapter.presentScene(userId, scene, viewerUrl)
```

The `viewerUrl` is constructed as:

```
https://<viewer-host>/scene/<sceneId>?session=<sessionId>
```

The viewer uses `sessionId` from the query string to establish the WebSocket connection and attribute interactions to the correct agent session.

---

## Data Storage

### Tables (PostgreSQL / SQLite)

```sql
-- Persistent scenes
scenes (
  scene_id       TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL,
  title          TEXT,
  description    TEXT,
  scene_data     JSONB,
  provider_ref   JSONB,
  version        INTEGER DEFAULT 1,
  created_at     TIMESTAMP,
  updated_at     TIMESTAMP
)

-- User sessions
sessions (
  session_id     TEXT PRIMARY KEY,  -- userId:channelId
  user_id        TEXT NOT NULL,
  channel_id     TEXT NOT NULL,
  active_scene_id TEXT REFERENCES scenes(scene_id),
  agent_messages JSONB,             -- serialized pi-agent-core message history
  updated_at     TIMESTAMP
)

-- Scene version history (for rollback)
scene_versions (
  scene_id       TEXT,
  version        INTEGER,
  scene_data     JSONB,
  provider_ref   JSONB,
  created_at     TIMESTAMP,
  PRIMARY KEY (scene_id, version)
)
```

---

## Request Flow: "Create me a medieval castle"

```
User (Telegram) ──► TelegramAdapter
                       │ ChatMessage
                       ▼
                   ChannelGateway
                       │
                       ▼
                   SessionManager.dispatch()
                       │ load session, get Agent
                       ▼
                   Agent.prompt("Create me a medieval castle")
                       │ LLM decides to call create_scene
                       ▼
                   create_scene tool
                       │
                       ▼
                   SceneManager.createScene("medieval castle")
                       │
                       ▼
                   MarbleProvider.generate("medieval castle")
                       │ returns ProviderResult
                       ▼
                   Store Scene in DB (v1)
                       │
                       ▼
                   Agent receives tool result
                       │ LLM generates reply
                       ▼
                   "Your castle is ready! [view link]"
                       │
                       ▼
                   TelegramAdapter.sendText(userId, reply)
```

---

## Project Structure (Option B)

```
scratch-world/
├── doc/
│   └── architecture.md
├── src/                              # Bot backend
│   ├── channels/
│   │   ├── types.ts                  # ChannelAdapter interface, ChatMessage
│   │   ├── gateway.ts                # ChannelGateway
│   │   └── telegram/
│   │       └── adapter.ts            # TelegramAdapter (incl. presentScene)
│   ├── session/
│   │   └── session-manager.ts
│   ├── agent/
│   │   ├── agent-factory.ts
│   │   └── tools/
│   │       ├── create-scene.ts
│   │       ├── update-scene.ts
│   │       ├── get-scene.ts
│   │       ├── list-scenes.ts
│   │       ├── navigate-to.ts
│   │       └── interact-with-object.ts
│   ├── scene/
│   │   ├── scene-manager.ts
│   │   └── types.ts
│   ├── providers/
│   │   ├── types.ts                  # ThreeDProvider interface
│   │   ├── marble/
│   │   │   └── provider.ts
│   │   └── stub/
│   │       └── provider.ts
│   ├── storage/
│   │   ├── types.ts                  # repository interfaces
│   │   └── sqlite/
│   │       ├── scene-repo.ts
│   │       └── session-repo.ts
│   ├── viewer-api/
│   │   ├── server.ts                 # HTTP + WebSocket server
│   │   └── routes/
│   │       ├── scenes.ts             # GET /scenes/:sceneId
│   │       └── interact.ts           # POST /interact
│   └── index.ts
├── viewer/                           # Viewer App (separate frontend)
│   ├── src/
│   │   ├── renderer/                 # Three.js / Babylon.js scene rendering
│   │   ├── components/               # UI overlays (narrative text, HUD)
│   │   └── api.ts                    # Viewer API client + WebSocket
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── test/
├── package.json
├── tsconfig.json
├── biome.json
└── CLAUDE.md
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Agent core | pi-agent-core | Battle-tested, streaming, tool calling, message history |
| 3D provider | Abstracted interface | Marble is MVP; need to swap when better options emerge |
| Channel adapters | Pluggable interface | Telegram MVP; other channels added without core changes |
| Viewer launch | `presentScene()` per adapter | Each channel opens the viewer natively (TWA, WeChat H5, URL) |
| Viewer ↔ backend | Viewer API (HTTP + WebSocket) | Decouples frontend from bot internals; SSE/WS for real-time LLM output |
| Storage | Repository pattern | Decouple business logic from DB implementation |
| Scene versioning | Snapshot on every edit | Enables rollback, diff, and history replay |
| LLM model | Claude Sonnet (default) | Best coding/reasoning ratio; configurable per session |

---

## Future Modules (out of scope for MVP)

- **NPC System** — SceneObject with `interactionScript`, dialogue engine
- **Multi-user scenes** — shared scene ownership, real-time sync across multiple viewer sessions
- **Scene gallery** — public/private scene browsing with thumbnail previews
- **Voice channels** — Discord voice → speech-to-text → same agent pipeline
- **Viewer on Discord** — Discord Embedded App (Activities) for in-app 3D viewing
- **Context compaction** — `transformContext` hook on pi-agent-core to prune old messages and prevent context window overflow
