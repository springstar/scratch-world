# NPC System

**Last Updated:** 2026-04-07

Reactive, persistent, self-evolving NPCs for scratch-world scenes. Each NPC maintains personality, memory, an interaction counter, and an optional evolution log — all stored in `SceneObject.metadata`. No separate NPC table; NPCs are ordinary scene objects of `type="npc"`.

---

## Architecture Overview

```
Player walks near NPC
  → SplatViewer proximity detection (npc-proximity.ts, 2.5 m radius)
  → onNpcApproach fires → POST /npc-greet (fire-and-forget)
      → greetAsNpc() → Haiku → npc_speech event → NpcChatOverlay opens
  → Player types message → POST /npc-interact
      → ACTION_PATTERN? → runNpcAgent() (tool-use loop)
                        : → reactAsNpc() (fast path)
      → npc_speech / npc_move / npc_emote events → viewer
      → updateMemory() + counter++ + evolution trigger (async, not blocking)
  → Player leaves radius → onNpcLeave fires → NpcChatOverlay closes

World tick (every 5 min)
  → npc-heartbeat.ts → spontaneousNpcLine() → npc_speech (15% per NPC)

PerceptionBus (after any NPC reply)
  → bystander NPCs within 15 m: 15% chance → spontaneousNpcLine()
```

---

## Data Model

NPCs are `SceneObject` instances with `type="npc"`. All NPC-specific state lives in `metadata`:

| Field | Type | Description |
|---|---|---|
| `npcPersonality` | `string` | Free-text personality prompt injected as system prompt |
| `npcTraits` | `string?` | Optional trait keywords (e.g. "擅长烹饪、记忆力强") |
| `npcMemory` | `string[]` | Condensed fact array; updated after each interaction |
| `npcInteractionCount` | `number` | Cumulative interaction count; triggers evolution at multiples of 20 |
| `npcEvolutionLog` | `EvolutionLogEntry[]` | Pending / approved / rejected evolution proposals |
| `modelUrl` | `string` | GLB/GLTF URL for the NPC's 3D model |
| `scale` | `number?` | Model scale override |
| `placement` | `string?` | Placement hint used at creation time |

`interactable: true` is always set on NPCs so proximity detection picks them up.

---

## Backend Modules (`src/npcs/`)

### `npc-runner.ts`

Core LLM calls. All functions use **claude-haiku-4-5-20251001** for low latency and cost.

| Export | Cooldown | Purpose |
|---|---|---|
| `reactAsNpc(npcId, npcName, personality, userText, memory?, perceptionContext?)` | 10 s | Fast single-turn reply to player message |
| `spontaneousNpcLine(npcId, npcName, personality, memory?, perceptionContext?)` | 4 min | Heartbeat one-liner; separate cooldown track from chat |
| `greetAsNpc(npcId, npcName, personality, memory?, perceptionContext?)` | 60 s | Auto-greeting when player enters proximity |
| `updateMemory(npcName, existingMemory, userText, npcReply)` | — | Extract 1–3 facts from exchange; compress when cap (20) exceeded |

**Memory management:** After each exchange, Haiku extracts up to 3 facts from the exchange and appends them to the memory array. When the array exceeds 20 items the oldest half is compressed into ≤5 summary lines by a second Haiku call, then merged with the retained newer half. On compression failure the array is truncated from the front.

**Perception context** injected into every system prompt when available:
- Current time of day and weather (from `scene.environment`)
- Player distance in metres
- Up to 5 nearest non-terrain objects with distances

### `npc-agent.ts`

Tool-use agent loop for action requests. Uses the `Agent` class from `@mariozechner/pi-agent-core`.

Activated when `userText` matches `ACTION_PATTERN` in `npc-interact.ts`:
```
/去|走|过来|跟我|找|移动|带我|带路|看看|查看|做个|表演|鞠躬|挥手|你能|请你|帮我|go|come|move|find|show|look at/i
```

Four tools available to the NPC:

| Tool | Effect |
|---|---|
| `speak(text)` | Publishes `npc_speech` event; viewer shows in NpcChatOverlay |
| `observe_scene()` | Returns list of up to 10 nearby non-terrain objects with positions |
| `move_to(x, z)` | Publishes `npc_move` event; viewer interpolates NPC model over 1.5 s |
| `emote(animation)` | Publishes `npc_emote` event; valid values: `idle / walk / talk / wave / bow` |

Timeout: 15 s (AbortController). The agent must call `speak()` at least once (enforced in system prompt). A `patchedBus` wrapper intercepts the first `npc_speech` publish to capture the spoken text for post-interaction memory/counter update.

### `npc-evolution.ts`

Personality drift triggered every `EVOLUTION_THRESHOLD` (20) interactions.

```
Interaction 20, 40, 60…
  → generateEvolutionDiff(npcName, currentPersonality, memory)
    → Haiku analyses memory vs personality
    → Returns 1–2 sentence suggested delta, or null ("无需改变")
  → createEvolutionEntry() → appended to metadata.npcEvolutionLog with status="pending"

User reviews in NpcDrawer → approve / reject
  → approve: applyEvolutionDelta(npcName, currentPersonality, delta)
    → Haiku rewrites personality string (≤130% original length)
    → PATCH /scenes/:sceneId/npcs/:npcId with new npcPersonality
  → reject: entry.status = "rejected", no personality change
```

`EvolutionLogEntry` shape:
```typescript
interface EvolutionLogEntry {
  id: string;              // 8-char UUID prefix
  triggeredAt: number;     // epoch ms
  interactionCount: number;
  currentPersonality: string;
  suggestedDelta: string;
  status: "pending" | "approved" | "rejected";
  appliedAt?: number;
}
```

### `npc-heartbeat.ts`

World-tick process. Starts on server startup via `startNpcHeartbeat(sceneManager, bus)`.

- Interval: **5 minutes** (`setInterval`, `unref()`-ed so it doesn't prevent process exit)
- Per tick: iterates all sessions with active WebSocket connections
- Per session: fetches scenes, picks the most recently updated, selects one NPC at random
- Fires `spontaneousNpcLine()` with **15% probability** per tick
- Publishes `npc_speech` event with `sceneId` so the viewer filters cross-scene events

---

## API Endpoints

All NPC endpoints live under `src/viewer-api/routes/`.

### `POST /npc-greet`

Triggered by proximity detection when player enters 2.5 m of an NPC.

```
Body: { sessionId, sceneId, npcObjectId, playerPosition? }
Response: { ok: true }   (immediate; greeting arrives via WebSocket)
```

Fire-and-forget: calls `greetAsNpc()`, publishes `npc_speech` event. The client-side `greetedNpcsRef` Set prevents repeated greetings per session per NPC; the server-side `greetCooldowns` map enforces a 60 s minimum between greetings.

### `POST /npc-interact`

Main interaction endpoint.

```
Body: { sessionId, sceneId, npcObjectId, userText, playerPosition? }
Response: { ok: true }   (immediate; reply arrives via WebSocket)
```

Routing logic:
1. `ACTION_PATTERN.test(userText)` → `runNpcAgent()` (tool-use loop, up to 15 s)
2. Otherwise → `reactAsNpc()` (single Haiku call, ~1 s)

Both paths call `handlePostInteraction()` after completion (async, not blocking):
- `updateMemory()` — extract facts and persist to `npcMemory`
- Increment `npcInteractionCount`
- If `count % 20 === 0` → `generateEvolutionDiff()` → append to `npcEvolutionLog`
- `sceneManager.updateSceneObject()` — single metadata patch write

**PerceptionBus:** after any NPC reply, bystander NPCs within 15 m each have a 15% chance to react via `spontaneousNpcLine()`. Their lines are published as independent `npc_speech` events.

### NPC CRUD (`src/viewer-api/routes/scenes.ts`)

Mounted under `/scenes/:sceneId/npcs`:

| Method | Path | Action |
|---|---|---|
| `POST` | `/scenes/:sceneId/npcs` | Add NPC; generates `objectId = npc_<8chars>` |
| `PATCH` | `/scenes/:sceneId/npcs/:npcId` | Update name, personality, traits |
| `DELETE` | `/scenes/:sceneId/npcs/:npcId` | Remove NPC (delegates to `removePropFromScene`) |
| `GET` | `/scenes/:sceneId/npcs/:npcId/evolution` | Fetch evolution log entries |
| `POST` | `/scenes/:sceneId/npcs/:npcId/evolution/approve` | Approve pending delta → apply + persist new personality |
| `POST` | `/scenes/:sceneId/npcs/:npcId/evolution/reject` | Reject pending delta, no personality change |

All endpoints require `?session=web:<userId>` and validate scene ownership.

---

## Scene Manager Extension

`SceneManager.updateSceneObject(sceneId, objectId, patch)` was added to support NPC metadata updates:

- `patch.metadata` is **merged** (not replaced) into the existing metadata object
- Increments `scene.version` and saves a versioned snapshot (immutable `scene_versions` row)
- Throws a `404`-tagged error if `objectId` is not found in the scene

---

## Frontend Components

### `NpcChatOverlay` (`viewer/src/components/NpcChatOverlay.tsx`)

In-viewer floating chat panel. Appears bottom-center of the viewport (z-index 120, above all other overlays).

- Opens automatically when player enters NPC proximity (`onNpcApproach` → `handleNpcApproach`)
- Closes automatically when player leaves proximity (`onNpcLeave` → `handleNpcLeave`)
- ESC key closes the overlay (capture phase listener to prevent game input)
- Input field stops `keydown` propagation so WASD/other game keys don't fire while typing
- Pending state: `···` blink animation while waiting for server reply
- History: user messages right-aligned (purple), NPC messages left-aligned (dark)

### `NpcDrawer` (`viewer/src/components/NpcDrawer.tsx`)

Right-side slide-in management panel (width 340 px, z-index 110).

Three views:
- **List** — all `type="npc"` objects in current scene; [编辑] [删除] buttons per card
- **Add** — form: name, personality, traits; model source (asset catalog grid or URL input); press F to aim placement; [确定放置] reads `window.__clickPosition` (within 30 s)
- **Edit** — prefilled form; includes evolution log section with [批准] [拒绝] buttons for pending proposals

Triggered by the "NPC" button (top-right corner of viewer, z-index 105).

---

## Viewer Integration (`SplatViewer.tsx`)

### Proximity Detection

`npc-proximity.ts` provides two functions used inside the physics loop:

- `extractNpcs(objects)` — filters to `type="npc"` with `interactable=true` or `npcPersonality` set
- `findNearbyNpc(npcs, cx, cy, cz, positionOverrides?)` — returns nearest NPC within **2.5 m**, or null

`positionOverrides` (`npcPositionsRef`) holds resolved world positions populated by `__loadSceneNpc`; falls back to `SceneObject.position` for scenes without a physics collider mesh.

The `nearbyNpc` React state drives a `useEffect` that fires:
- `onNpcApproach(objectId, name)` when a new NPC enters range
- `onNpcLeave()` when the player exits all NPC ranges

### NPC Movement and Emotes

Two `window` bridges registered inside the physics closure:

- `window.__moveNpc(npcId, { x, y, z })` — smooth 1.5 s `requestAnimationFrame` interpolation
- `window.__emoteNpc(npcId, animation)` — sets `group.userData.pendingAnimation`; animation playback is handled by the GLTF animation system

### App.tsx Wiring

| Handler | Trigger | Effect |
|---|---|---|
| `handleNpcApproach(objectId, name)` | `onNpcApproach` from SplatViewer | Exits pointer lock; opens NpcChatOverlay; sends greeting (once per session per NPC) |
| `handleNpcLeave()` | `onNpcLeave` from SplatViewer | Closes NpcChatOverlay |
| `sendNpcMessage(text)` | NpcChatOverlay `onSend` | POST /npc-interact with `playerPosition` |
| `handleSplatInteract(objectId, action)` | Object pick (E key) for props | Routes NPC type to chat overlay; otherwise to general interact |

`npc_speech` / `npc_move` / `npc_emote` realtime events are filtered by `event.sceneId` against `sceneRef.current.sceneId` before processing, preventing cross-scene event leakage.

---

## Realtime Events

Three NPC-specific event types on the WebSocket bus:

```typescript
{ type: "npc_speech"; npcId: string; npcName: string; text: string; sceneId?: string }
{ type: "npc_move";   npcId: string; position: { x: number; y: number; z: number }; sceneId?: string }
{ type: "npc_emote";  npcId: string; animation: string; sceneId?: string }
```

`sceneId` is always set by the server. The viewer ignores events where `sceneId` doesn't match the loaded scene.

---

## Cooldown Summary

| Mechanism | Cooldown | Scope |
|---|---|---|
| `reactAsNpc` chat cooldown | 10 s | Per NPC, in-memory |
| `greetAsNpc` greeting cooldown | 60 s | Per NPC, in-memory |
| `spontaneousNpcLine` heartbeat cooldown | 4 min | Per NPC, in-memory |
| Client-side `greetedNpcsRef` | Session lifetime | Per scene+NPC pair, resets on scene load |
| Evolution trigger | Every 20 interactions | Per NPC, persisted in `npcInteractionCount` |

All in-memory cooldowns reset on server restart.

---

## File Reference

| File | Purpose |
|---|---|
| `src/npcs/npc-runner.ts` | Core LLM calls: react, greet, heartbeat, memory |
| `src/npcs/npc-agent.ts` | Tool-use agent loop (speak / observe / move / emote) |
| `src/npcs/npc-heartbeat.ts` | World-tick spontaneous speech every 5 min |
| `src/npcs/npc-evolution.ts` | Personality diff generation, delta application, log entries |
| `src/viewer-api/routes/npc-interact.ts` | POST /npc-interact — routing, PerceptionBus, memory update |
| `src/viewer-api/routes/npc-greet.ts` | POST /npc-greet — proximity greeting |
| `src/viewer-api/routes/scenes.ts` | NPC CRUD + evolution approve/reject endpoints |
| `src/scene/scene-manager.ts` | `updateSceneObject()` — metadata merge with versioning |
| `viewer/src/physics/npc-proximity.ts` | Proximity radius constants and nearest-NPC search |
| `viewer/src/components/NpcChatOverlay.tsx` | Floating in-viewer chat UI |
| `viewer/src/components/NpcDrawer.tsx` | NPC management drawer (add / edit / delete / evolution) |
| `viewer/src/App.tsx` | Event wiring: approach/leave/message/realtime |
| `viewer/src/api.ts` | Client API: postNpcInteract, postNpcGreet, addSceneNpc, updateSceneNpc, removeSceneNpc, fetchNpcEvolution, approveNpcEvolution, rejectNpcEvolution |
