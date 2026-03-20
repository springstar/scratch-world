# scratch-world

A chat-driven AI agent for creating and exploring persistent 3D worlds through natural conversation. Describe a place, and the agent builds it. Ask to change something, and it evolves. Navigate around, interact with objects — all through plain text in a messaging app.

## How it works

```
User message  →  Channel Adapter  →  Session Manager  →  AI Agent (Claude)
                                                               │
                                                    scene tools (create, update, navigate...)
                                                               │
                                                         Scene Manager
                                                               │
                                                       3D Provider (Marble / Stub)
                                                               │
                                                     Viewer App (browser)
```

- **Channel adapters**: Telegram (production), stdin (local testing)
- **AI agent**: Claude Sonnet via pi-agent-core, with 6 scene tools
- **3D providers**: WorldLabs Marble (real 3D generation), Stub (local dev fixtures)
- **Viewer**: Vite + React app served at `localhost:5173`, proxies API to backend at `3001`
- **Storage**: SQLite (dev) or PostgreSQL (prod), persists scenes and conversation history

## Quickstart (local testing, no Telegram required)

### 1. Install dependencies

```bash
npm install
cd viewer && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
CHANNEL=stdin                          # use stdin instead of Telegram
ANTHROPIC_API_KEY=sk-...               # Anthropic API key
# ANTHROPIC_BASE_URL=https://...       # optional: proxy (e.g. ofox)
VIEWER_BASE_URL=http://localhost:5173  # must point to Vite dev server
```

### 3. Start the backend

```bash
npm run dev
```

You should see:
```
[stdin] Ready. Type a message and press Enter. Ctrl+C to exit.
Viewer API listening on http://localhost:3001
```

### 4. Start the viewer (optional, in a second terminal)

```bash
cd viewer && npm run dev
```

Vite starts at `http://localhost:5173` and proxies API calls to `3001`.

### 5. Chat

Type in the terminal running `npm run dev`:

```
创建一个古代森林
在森林里加一条河
导航到河边
```

When a scene is created, the bot prints a viewer URL. Open it in a browser to see the 3D scene.

## Running with Telegram

1. Create a bot via [@BotFather](https://t.me/botfather) and get a token
2. Set `CHANNEL=telegram` and `TELEGRAM_BOT_TOKEN=<token>` in `.env`
3. Run `npm run dev`
4. Message your bot on Telegram

## Available commands (npm scripts)

| Command | Description |
|---|---|
| `npm run dev` | Start backend (tsx, no build step) |
| `npm test` | Run unit tests (vitest) |
| `npm run check` | TypeScript type check + Biome lint |
| `npm run format` | Auto-format source files |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CHANNEL` | `telegram` | `telegram` or `stdin` |
| `TELEGRAM_BOT_TOKEN` | — | Required when `CHANNEL=telegram` |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `ANTHROPIC_BASE_URL` | _(Anthropic default)_ | Override API base URL (e.g. ofox proxy) |
| `PROVIDER` | `stub` | `marble` or `stub` |
| `MARBLE_API_KEY` | — | Required when `PROVIDER=marble` |
| `DATABASE_URL` | `sqlite:./dev.db` | `sqlite:<path>` or `postgres://...` |
| `VIEWER_API_PORT` | `3001` | Port for the Viewer API / WebSocket server |
| `VIEWER_BASE_URL` | `http://localhost:5173` | Base URL for viewer links sent to users |
| `AGENT_MAX_TURNS` | `20` | Max conversation turns kept in agent context |

## Development status

**Stage: Prototype with core 3D rendering — message pipeline, scene tools, and viewer rendering working.**

What works:
- Full message pipeline: stdin/Telegram → agent → tool calls → reply
- All 6 scene tools: `create_scene`, `update_scene`, `get_scene`, `list_scenes`, `navigate_to`, `interact_with_object`
- SQLite persistence for scenes and session history
- Viewer API server (HTTP + WebSocket) running and reachable
- Per-session conversation continuity across restarts
- Context trimming to prevent unbounded message history growth
- Concurrent message handling (per-session serial queue)
- Unit tests for core components
- Three.js renderer (viewer/src/renderer/scene-renderer.ts) with:
  - Procedurally generated objects (terrain, buildings, trees, NPCs, items)
  - Post-processing bloom effects (configurable per scene)
  - GLTF/GLB model loading from URLs
  - Code generation mode for custom Three.js animations and effects
  - Interaction system with raycast picking

What is not yet implemented:
- Marble provider — `StubProvider` returns static fixtures; real 3D generation requires a Marble API key and a working integration
- Telegram `presentScene()` — sends a URL but the Web App button integration is minimal
- Scene versioning / rollback — schema is defined but `scene_versions` table is not populated
- Multi-user scenes, NPC dialogue, scene gallery — planned, not started

## Project layout

```
scratch-world/
├── src/
│   ├── channels/          # Channel adapters (Telegram, stdin) + gateway
│   ├── agent/             # Agent factory, scene tools, context trimmer
│   ├── scene/             # Scene manager + domain types
│   ├── providers/         # 3D provider interface, Marble + Stub implementations
│   ├── storage/           # Repository interfaces + SQLite implementations
│   ├── viewer-api/        # HTTP + WebSocket server for the viewer
│   └── index.ts           # Entry point
├── viewer/                # Viewer frontend (Vite + React)
├── test/                  # Unit tests (vitest)
├── doc/
│   ├── architecture.md    # Full system design
│   └── debug-log.md       # Startup issues and fixes
├── .env.example
└── CLAUDE.md
```

See [doc/architecture.md](doc/architecture.md) for a detailed system diagram and design rationale.
