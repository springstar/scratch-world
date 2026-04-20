import type { DisplayConfig, SceneResponse, RealtimeEvent, ResourceOption } from "./types.js";

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

export async function postNpcGreet(payload: {
  sessionId: string;
  sceneId: string;
  npcObjectId: string;
  playerPosition?: { x: number; y: number; z: number };
}): Promise<void> {
  const res = await fetch(`${BASE}/npc-greet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

export async function postNpcInteract(payload: {
  sessionId: string;
  sceneId: string;
  npcObjectId: string;
  userText: string;
  playerPosition?: { x: number; y: number; z: number };
  chatHistory?: { role: "user" | "npc"; text: string }[];
}): Promise<void> {
  const res = await fetch(`${BASE}/npc-interact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

export async function postInteract(payload: {
  sessionId: string;
  sceneId: string;
  objectId: string;
  action: string;
  playerPosition?: { x: number; y: number; z: number };
  interactionData?: Record<string, unknown>;
}): Promise<{ display?: DisplayConfig }> {
  const res = await fetch(`${BASE}/interact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ display?: DisplayConfig }>;
}

export async function postChat(payload: {
  sessionId: string;
  userId: string;
  text: string;
  sceneId?: string;
  images?: Array<{ base64: string; mimeType: string }>;
  playerPosition?: { x: number; y: number; z: number };
  clickPosition?: { x: number; y: number; z: number };
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

export async function addSceneProp(
  sceneId: string,
  sessionId: string,
  prop: {
    name: string;
    description: string;
    modelUrl: string;
    physicsShape?: string;
    mass?: number;
    scale?: number;
    placement?: string;
    playerPosition?: { x: number; y: number; z: number };
  },
): Promise<{ objectId: string; version: number }> {
  const res = await fetch(`${BASE}/scenes/${sceneId}/props?session=${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prop),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ objectId: string; version: number }>;
}

export async function addSceneNpc(
  sceneId: string,
  sessionId: string,
  npc: {
    name: string;
    personality: string;
    traits?: string;
    skills?: string[];
    modelUrl: string;
    scale?: number;
    targetHeight?: number;
    placement?: string;
    playerPosition?: { x: number; y: number; z: number };
    cameraForward?: { x: number; z: number };
  },
): Promise<{ objectId: string; version: number }> {
  const res = await fetch(`${BASE}/scenes/${sceneId}/npcs?session=${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(npc),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ objectId: string; version: number }>;
}

export async function updateSceneNpc(
  sceneId: string,
  sessionId: string,
  npcId: string,
  patch: { name?: string; personality?: string; traits?: string; skills?: string[] },
): Promise<{ version: number }> {
  const res = await fetch(
    `${BASE}/scenes/${sceneId}/npcs/${encodeURIComponent(npcId)}?session=${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ version: number }>;
}

export interface EvolutionLogEntry {
  id: string;
  triggeredAt: number;
  interactionCount: number;
  currentPersonality: string;
  suggestedDelta: string;
  status: "pending" | "approved" | "rejected";
  appliedAt?: number;
}

export async function fetchNpcEvolution(
  sceneId: string,
  npcId: string,
): Promise<{ npcId: string; interactionCount: number; log: EvolutionLogEntry[] }> {
  const res = await fetch(`${BASE}/scenes/${sceneId}/npcs/${encodeURIComponent(npcId)}/evolution`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ npcId: string; interactionCount: number; log: EvolutionLogEntry[] }>;
}

export async function approveNpcEvolution(
  sceneId: string,
  sessionId: string,
  npcId: string,
  entryId: string,
): Promise<{ newPersonality: string; version: number }> {
  const res = await fetch(
    `${BASE}/scenes/${sceneId}/npcs/${encodeURIComponent(npcId)}/evolution/${entryId}/approve?session=${encodeURIComponent(sessionId)}`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ newPersonality: string; version: number }>;
}

export async function rejectNpcEvolution(
  sceneId: string,
  sessionId: string,
  npcId: string,
  entryId: string,
): Promise<{ version: number }> {
  const res = await fetch(
    `${BASE}/scenes/${sceneId}/npcs/${encodeURIComponent(npcId)}/evolution/${entryId}/reject?session=${encodeURIComponent(sessionId)}`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ version: number }>;
}

export async function removeSceneNpc(
  sceneId: string,
  sessionId: string,
  npcId: string,
): Promise<{ version: number }> {
  const res = await fetch(
    `${BASE}/scenes/${sceneId}/npcs/${encodeURIComponent(npcId)}?session=${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ version: number }>;
}

export async function patchSceneObjectPosition(
  sceneId: string,
  sessionId: string,
  objectId: string,
  position: { x: number; y: number; z: number },
  skillConfig?: Record<string, unknown>,
  displayY?: number,
): Promise<void> {
  const res = await fetch(
    `${BASE}/scenes/${sceneId}/objects/${encodeURIComponent(objectId)}?session=${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placement: "fixed", playerPosition: position, skillConfig, ...(typeof displayY === "number" ? { displayY } : {}) }),
    },
  );
  if (!res.ok) {
    console.warn(`patchSceneObjectPosition failed for ${objectId}: HTTP ${res.status}`);
  }
}

export async function generateProp(
  sceneId: string,
  sessionId: string,
  payload: {
    description?: string;
    imageBase64?: string;
    imageMimeType?: string;
    quality: "fast" | "balanced" | "quality";
  },
): Promise<{ jobId: string }> {
  const res = await fetch(
    `${BASE}/scenes/${sceneId}/generate-prop?session=${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ jobId: string }>;
}

export type GeneratePropJobStatus =
  | { status: "pending" }
  | { status: "done"; modelUrl: string; thumbnailUrl: string | null; name: string; scale: number }
  | { status: "error"; error: string };

export async function pollGenerateProp(
  sceneId: string,
  jobId: string,
): Promise<GeneratePropJobStatus> {
  const res = await fetch(`${BASE}/scenes/${sceneId}/generate-prop/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<GeneratePropJobStatus>;
}


export async function addScenePortal(
  sceneId: string,
  sessionId: string,
  portal: {
    name?: string;
    targetSceneId?: string;
    targetSceneName?: string;
    playerPosition?: { x: number; y: number; z: number };
  },
): Promise<{ objectId: string; version: number }> {
  const res = await fetch(`${BASE}/scenes/${sceneId}/portals?session=${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(portal),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ objectId: string; version: number }>;
}

export async function removeScenePortal(
  sceneId: string,
  sessionId: string,
  portalId: string,
): Promise<{ version: number }> {
  const res = await fetch(
    `${BASE}/scenes/${sceneId}/portals/${encodeURIComponent(portalId)}?session=${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ version: number }>;
}

export async function removeSceneProp(
  sceneId: string,
  sessionId: string,
  propId: string,
): Promise<{ version: number }> {
  const res = await fetch(
    `${BASE}/scenes/${sceneId}/props/${encodeURIComponent(propId)}?session=${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ version: number }>;
}

export async function uploadScreenshot(sceneId: string, dataUrl: string): Promise<void> {
  const res = await fetch(`${BASE}/screenshots/${sceneId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl }),
  });
  if (!res.ok) {
    // Non-fatal — evaluation will fall back to "no screenshot available"
    console.warn(`Screenshot upload failed for ${sceneId}: HTTP ${res.status}`);
  }
}

export interface SceneListItem {
  sceneId: string;
  title: string;
  status: "generating" | "ready" | "failed";
  createdAt: number;
  updatedAt: number;
  thumbnailUrl: string | null;
  provider: string;
}

export async function fetchSceneList(): Promise<SceneListItem[]> {
  const res = await fetch(`${BASE}/scenes`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { scenes: SceneListItem[] };
  return body.scenes;
}

export async function deleteScene(sceneId: string, sessionId: string): Promise<void> {
  const res = await fetch(
    `${BASE}/scenes/${encodeURIComponent(sceneId)}?session=${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

export interface UserAsset {
  id: string;
  sessionId: string;
  name: string;
  url: string;
  kind: "texture" | "model" | "audio" | "video";
  mimeType: string;
  createdAt: number;
}

export async function uploadUserAsset(
  sessionId: string,
  file: File,
  name?: string,
): Promise<UserAsset> {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  const res = await fetch(`${BASE}/user-assets?session=${encodeURIComponent(sessionId)}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { asset: UserAsset };
  return data.asset;
}

export async function fetchUserAssets(sessionId: string): Promise<UserAsset[]> {
  const res = await fetch(`${BASE}/user-assets?session=${encodeURIComponent(sessionId)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { assets: UserAsset[] };
  return data.assets;
}

/** Convert a UserAsset to a ResourceOption for use in ResourcePickerPanel */
export function userAssetToOption(asset: UserAsset): ResourceOption {
  return {
    id: `upload_${asset.id}`,
    name: asset.name,
    url: asset.url,
    thumbnail: asset.kind === "texture" ? asset.url : undefined,
    source: "upload",
  };
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
