# Debug Log: Initial Startup Issues

Date: 2026-03-17

## Issue 1: Viewer URL pointing to wrong port

**Symptom:** `presentScene()` was sending `http://localhost:3001/scene/...` to the user, but 3001 is the backend API port, not the viewer app.

**Root cause:** `VIEWER_BASE_URL` was not set in `.env`, so it defaulted to `http://localhost:${VIEWER_API_PORT}` (3001). In development, the viewer app runs on Vite's dev server (5173), which proxies API calls to 3001.

**Fix:** Set `VIEWER_BASE_URL=http://localhost:5173` in `.env`. The Vite dev server handles proxying `/scenes`, `/interact`, and `/realtime` to the backend.

---

## Issue 2: WebSocket not proxied in Vite dev server

**Symptom:** Viewer app's `connectRealtime()` would fail to establish a WebSocket connection in dev mode.

**Root cause:** `viewer/vite.config.ts` only proxied HTTP routes (`/scenes`, `/interact`), not the WebSocket endpoint (`/realtime`).

**Fix:** Added WebSocket proxy entry:
```typescript
"/realtime": { target: "ws://localhost:3001", ws: true },
```

---

## Issue 3: `ANTHROPIC_BASE_URL` not applied to model

**Symptom:** Agent was using `api.anthropic.com` instead of ofox proxy, causing auth failures.

**Root cause:** pi-ai's `getModel()` returns a model object with a hardcoded `baseUrl`. Setting `ANTHROPIC_BASE_URL` in `.env` had no effect without explicitly assigning it to the model object.

**Fix:** In `agent-factory.ts`, mutate the model's `baseUrl` after calling `getModel()`:
```typescript
const model = getModel("anthropic", "claude-sonnet-4-6");
if (process.env.ANTHROPIC_BASE_URL) {
    model.baseUrl = process.env.ANTHROPIC_BASE_URL;
}
```

---

## Issue 4: Wrong model ID for ofox

**Symptom:** Agent completed with `reply length: 0`. No text delta events, no tool calls. `onPayload` log showed the request was going to ofox with model `claude-sonnet-4-20250514`.

**Diagnosis steps:**
1. Added event logging in `_dispatch` — saw `agent_start/turn_start/message_start/message_end/agent_end` but no `message_update` or `text_delta`
2. Added `onPayload` callback — confirmed `baseUrl` was correct but model ID was `claude-sonnet-4-20250514`
3. Tested ofox API directly with curl — got `{"error":{"message":"Model 'claude-sonnet-4-20250514' not found"}}`
4. Tested `claude-sonnet-4-5` — worked

**Root cause:** ofox does not support the Anthropic date-suffixed model ID format (`claude-sonnet-4-20250514`). It uses the short form (`claude-sonnet-4-6`).

**Fix:** Changed `agent-factory.ts` to use `claude-sonnet-4-6` which is both a valid pi-ai type and recognized by ofox.

---

## Notes for future runs

- Always set `VIEWER_BASE_URL=http://localhost:5173` in dev `.env`
- ofox model IDs use short form without date suffix (e.g. `claude-sonnet-4-6`, not `claude-sonnet-4-20250514`)
- pi-ai does not read `~/.pi/agent/models.json` — that file is for the pi-agent CLI only
- Debug stubs left in code (`[agent]`, `[dispatch]` logs) should be removed before production
