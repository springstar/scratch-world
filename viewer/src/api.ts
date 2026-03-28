import type { SceneResponse, RealtimeEvent } from "./types.js";

const BASE = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE ?? "");

export async function fetchScene(sceneId: string, opts?: { token?: string; session?: string }): Promise<SceneResponse> {
  const params = new URLSearchParams();
  if (opts?.token) params.set("token", opts.token);
  if (opts?.session) params.set("session", opts.session);
  const qs = params.size ? `?${params.toString()}` : "";
  const res = await fetch(`${BASE}/scenes/${sceneId}${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<SceneResponse>;
}

export async function postInteract(payload: {
  sessionId: string;
  sceneId: string;
  objectId: string;
  action: string;
}): Promise<void> {
  const res = await fetch(`${BASE}/interact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

export async function postChat(payload: {
  sessionId: string;
  userId: string;
  text: string;
  images?: Array<{ base64: string; mimeType: string }>;
  playerPosition?: { x: number; y: number; z: number };
}): Promise<void> {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

export function connectRealtime(
  sessionId: string,
  onEvent: (event: RealtimeEvent) => void,
): () => void {
  const wsBase = BASE.replace(/^http/, "ws") || `ws://${location.host}`;
  const url = `${wsBase}/realtime/${encodeURIComponent(sessionId)}`;

  let ws: WebSocket;
  let closed = false;
  let retryDelay = 1000;

  function connect() {
    ws = new WebSocket(url);

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as RealtimeEvent;
        onEvent(event);
      } catch {
        // Malformed frame — ignore
      }
    };

    ws.onerror = () => {
      // Don't surface individual errors — onclose will handle reconnection
    };

    ws.onclose = () => {
      if (closed) return;
      // Reconnect with backoff (cap at 16 s)
      setTimeout(() => {
        if (!closed) {
          retryDelay = Math.min(retryDelay * 2, 16000);
          connect();
        }
      }, retryDelay);
    };

    ws.onopen = () => {
      retryDelay = 1000; // reset backoff on successful connect
    };
  }

  connect();

  return () => {
    closed = true;
    ws.close();
  };
}
