# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Chat-driven AI agent application. Users send natural language messages via messaging channels (Telegram MVP, later WeChat/Discord/WhatsApp). The agent interprets intent, calls tools to create and evolve persistent 3D scenes, and responds with scene links and narrative text.

**Key features:**
- Three.js viewer with procedurally generated and GLTF-loaded 3D objects
- Post-processing bloom effects (configurable per scene)
- Code generation mode for custom Three.js animations and effects
- Pluggable 3D provider backend (WorldLabs Marble MVP, Stub for local dev)

**Documentation:**
- `doc/architecture.md` — System design
- `doc/CODEMAP.md` — Architectural overview and module reference
- `doc/interactions.md` — Interaction system design
- `src/skills/built-in/renderer-threejs/SKILL.md` — Three.js rendering capabilities
- `src/skills/built-in/generator-claude/SKILL.md` — Scene generation guidelines

## Commands

After code changes (not documentation changes): `npm run check`. Get full output, no tail. Fix all errors, warnings, and infos before considering work complete.

```bash
npm install          # Install all dependencies
npm run build        # Compile TypeScript
npm run check        # Lint, format, and type check (biome)
npm run dev          # Start the bot (requires .env)
npm test             # Run all tests
```

Run specific tests from the package root:
```bash
npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts
```

Never commit unless the user asks.

## Project Structure

```
src/
├── channels/
│   ├── types.ts              # ChannelAdapter interface, ChatMessage, OutboundMedia
│   ├── gateway.ts            # ChannelGateway — starts adapters, routes messages
│   └── telegram/
│       └── adapter.ts        # TelegramAdapter
├── session/
│   └── session-manager.ts    # Load/persist Session, dispatch to Agent
├── agent/
│   ├── agent-factory.ts      # Wire Agent with tools + system prompt
│   └── tools/
│       ├── create-scene.ts   # Tool: create_scene(prompt, title?, sceneData?, sceneCode?)
│       ├── update-scene.ts   # Tool: update_scene(sceneId, instruction, sceneData?, sceneCode?)
│       ├── get-scene.ts
│       ├── list-scenes.ts
│       ├── navigate-to.ts
│       └── interact-with-object.ts
├── scene/
│   ├── scene-manager.ts      # Orchestrate provider calls, versioning, storage
│   ├── types.ts              # Scene, SceneData, SceneObject, Viewpoint, ProviderRef
│   └── schema.ts             # Typebox schemas for validation
├── providers/
│   ├── types.ts              # ThreeDProvider interface, ProviderResult
│   ├── marble/
│   │   └── provider.ts       # MarbleProvider — WorldLabs Marble API
│   └── stub/
│       └── provider.ts       # StubProvider — static fixtures, no API key needed
├── storage/
│   ├── types.ts              # SceneRepository, SessionRepository interfaces
│   ├── scene-repo.ts
│   └── session-repo.ts
└── index.ts                  # Entrypoint: wire everything, start gateway

viewer/
├── src/
│   ├── components/
│   │   └── ViewerCanvas.tsx  # React wrapper for scene-renderer.ts (async loadScene)
│   ├── renderer/
│   │   └── scene-renderer.ts # Three.js: builds scene from SceneData (modes: JSON/GLTF/bloom/code)
│   ├── types.ts              # Viewer-side types (mirrors src/scene/types.ts)
│   └── index.tsx
└── ...
```

## Code Quality

- No `any` types unless absolutely necessary. Check `node_modules` for external API types before guessing.
- Never use inline/dynamic imports. Always use standard top-level imports.
- Never remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead.
- Always ask before removing functionality that appears intentional.
- Immutability: always return new objects, never mutate existing ones.
- Functions under 50 lines, files under 800 lines. Extract when exceeded.

## Style

- No emojis in commits, comments, or code.
- No fluff or cheerful filler text in responses.
- Technical prose only. Direct and concise.
- Error messages must be user-facing friendly but server logs must include full context.

## Environment Variables

Required in `.env`:

```
# Channel adapters
TELEGRAM_BOT_TOKEN=

# 3D provider
MARBLE_API_KEY=
MARBLE_API_URL=

# Storage
DATABASE_URL=           # PostgreSQL connection string, or "sqlite:./dev.db"

# LLM (pi-ai)
ANTHROPIC_API_KEY=

# Web search (required — enables real-time research for named real-world places)
TAVILY_API_KEY=      # Tavily Search API key — free tier (1000/month) at https://tavily.com
                     # Returns full page content, not just snippets

# Image-to-3D (Tencent Hunyuan 3D)
HUNYUAN_API_KEY=     # API key from https://console.cloud.tencent.com (Hunyuan 3D product)
```

Never commit `.env` or any file containing secrets.

## Adding a New Channel Adapter

1. `src/channels/<name>/adapter.ts` — implement `ChannelAdapter` interface:
   - `channelId: string`
   - `start()`, `stop()`
   - `onMessage(handler)`
   - `sendText(userId, text)`, `sendMedia(userId, media)`
2. Register the adapter in `src/index.ts` by passing it to `ChannelGateway`.
3. Add `<NAME>_BOT_TOKEN` (or equivalent credential) to `.env` and document above.
4. Add adapter to the supported channels table in `doc/architecture.md`.

## Scene Generation and Rendering

The viewer supports **three rendering paths** via `sceneData` and `sceneCode` parameters:

### Path A: Procedural Object Generation (Default)

`sceneData.objects` contains a JSON array of scene objects. The renderer builds Three.js meshes procedurally based on `type` and `metadata.shape`. Examples: `terrain/floor`, `object/desk`, `tree`, `npc`, `item`.

Use when: Simple scenes with standard furniture, terrain, NPCs, trees, buildings.

### Path B: GLTF Model Loading

Any object can load a real 3D model by setting `metadata.modelUrl` to a CORS-accessible GLTF or GLB URL.

Use when: You want to include specific 3D models (via free CDNs like Kenney.nl, Quaternius, or KhronosGroup glTF Sample Assets).

Example metadata:
```json
{
  "modelUrl": "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/Duck/glTF/Duck.gltf",
  "scale": 0.01,
  "yOffset": 0.5
}
```

### Path C: Custom Code Generation

When `sceneData.sceneCode` is provided, the renderer bypasses JSON parsing and executes the code in a sandbox. Full Three.js control available.

Use when: Custom animations, particle systems, procedural geometry, custom shaders.

Sandbox variables: `THREE`, `scene`, `camera`, `renderer`, `controls`, `animate(cb)`

Example:
```javascript
const geometry = new THREE.SphereGeometry(5, 32, 32);
const material = new THREE.MeshStandardMaterial({ color: 0xff00ff });
const sphere = new THREE.Mesh(geometry, material);
scene.add(sphere);

animate((delta) => {
  sphere.rotation.y += delta * 0.5;
});
```

---

### Path D: Post-Processing Bloom Effects

All scenes support configurable bloom via `environment.effects.bloom`:

```json
{
  "strength": 0.4,      // glow intensity
  "radius": 0.3,        // bloom spread
  "threshold": 0.85     // brightness threshold to trigger glow
}
```

Night scenes auto-apply bloom strength ≥ 0.8 for enhanced mood.

---

## Adding a New 3D Provider

1. `src/providers/<name>/provider.ts` — implement `ThreeDProvider` interface:
   - `name: string`
   - `generate(prompt, options?)` → `ProviderResult`
   - `edit(ref, instruction, options?)` → `ProviderResult`
   - `describe(ref)` → `ProviderDescription`
2. Add provider credential(s) to `.env` section above.
3. Register provider in `src/index.ts` and select via env var `PROVIDER=marble|stub|...`.
4. Update provider comparison table in `doc/architecture.md`.

## Scene Versioning

Every call to `SceneManager.updateScene()` must:
1. Increment `scene.version`.
2. Write a snapshot row to `scene_versions` before applying the update.
3. Return the updated `Scene`.

Never overwrite `scene_versions` rows. They are immutable once written.

## Testing

- Unit tests for all tools in `src/agent/tools/`.
- Integration tests for `SceneManager` using `StubProvider`.
- Do not call live Marble API or Telegram API in tests. Use stubs/mocks.
- 80% coverage minimum.

## Git Rules

- Only commit files you changed in this session.
- Never use `git add -A` or `git add .`. Always `git add <specific-files>`.
- Never `--no-verify`, never `git reset --hard`, never force push.
- Commit format: `<type>: <description>` (feat / fix / refactor / docs / test / chore).

## CRITICAL Tool Usage Rules

- Never use sed/cat to read files. Always use the Read tool (offset + limit for range reads).
- Read every file in full before editing it.
