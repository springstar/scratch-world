import { useState, useEffect, useCallback, useRef } from "react";
import { ViewerCanvas } from "./components/ViewerCanvas.js";
import { NpcDrawer } from "./components/NpcDrawer.js";
import { NpcChatOverlay } from "./components/NpcChatOverlay.js";
import type { NpcChatMessage } from "./components/NpcChatOverlay.js";
import { SplatViewer } from "./components/SplatViewer.js";
import { NarrativeOverlay } from "./components/NarrativeOverlay.js";
import { uploadScreenshot } from "./api.js";
import { ViewpointBar } from "./components/ViewpointBar.js";
import { InteractionPrompt } from "./components/InteractionPrompt.js";
import { StarField } from "./components/StarField.js";
import { ChatDrawer } from "./components/ChatDrawer.js";
import type { ChatMessage, SceneCard, PendingImage } from "./components/ChatDrawer.js";
import { fetchScene, postInteract, postNpcInteract, postNpcGreet, postChat, connectRealtime, addSceneProp, fetchSceneList, deleteScene } from "./api.js";
import type { SceneResponse, Viewpoint, RealtimeEvent, SceneObject } from "./types.js";

// ── Session identity ──────────────────────────────────────────────────────────
function getOrCreateUserId(): string {
  const key = "scratch_world_user_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function parseUrl(): { sceneId: string | null; token: string | null } {
  const match = location.pathname.match(/\/scene\/([^/?#]+)/);
  const token = new URLSearchParams(location.search).get("token");
  return { sceneId: match?.[1] ?? null, token };
}

interface SelectedObject {
  objectId: string;
  name: string;
  interactable: boolean;
}

let msgCounter = 0;
function nextId() { return String(++msgCounter); }

// Fuzzy match: every character of query must appear in text in order
function fuzzyMatch(text: string, query: string): boolean {
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    while (ti < text.length && text[ti] !== ch) ti++;
    if (ti >= text.length) return false;
    ti++;
  }
  return true;
}

export function App() {
  const userId = useRef(getOrCreateUserId());
  const sessionId = `web:${userId.current}`;

  const [scene, setScene] = useState<SceneResponse | null>(null);
  const sceneRef = useRef<SceneResponse | null>(null);
  const [urlInfo] = useState(parseUrl);
  const [sceneError, setSceneError] = useState<string | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [sceneCards, setSceneCards] = useState<SceneCard[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const streamingIdRef = useRef<string | null>(null);

  // Viewer state
  const [narrativeLines, setNarrativeLines] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selected, setSelected] = useState<SelectedObject | null>(null);
  const [activeViewpoint, setActiveViewpoint] = useState<Viewpoint | null>(null);
  const streamingBuffer = useRef("");
  const [npcSpeech, setNpcSpeech] = useState<{ npcId: string; npcName: string; text: string } | null>(null);
  const npcSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showNpcDrawer, setShowNpcDrawer] = useState(false);

  // NPC chat session
  const [npcChatTarget, setNpcChatTarget] = useState<{ objectId: string; name: string } | null>(null);
  const [npcChatHistory, setNpcChatHistory] = useState<NpcChatMessage[]>([]);
  const [npcChatPending, setNpcChatPending] = useState(false);
  // Track which NPCs have already greeted this session (key: sceneId:npcId)
  const greetedNpcsRef = useRef<Set<string>>(new Set());

  // Load a scene and jump to its first viewpoint
  const loadSceneById = useCallback(
    (sceneId: string, opts?: { token?: string; session?: string }) => {
      fetchScene(sceneId, opts)
        .then((s) => {
          setScene(s);
          sceneRef.current = s;
          setActiveViewpoint(s.sceneData.viewpoints[0] ?? null);
          greetedNpcsRef.current.clear();
          history.pushState(null, "", `/scene/${sceneId}?session=${sessionId}`);
        })
        .catch((err) => {
          setSceneError(err instanceof Error ? err.message : "Failed to load scene");
          console.error(err);
        });
    },
    [sessionId],
  );

  // Load initial scene from URL if specified
  useEffect(() => {
    if (!urlInfo.sceneId) return;
    loadSceneById(urlInfo.sceneId, { token: urlInfo.token ?? undefined, session: sessionId });
  }, [urlInfo.sceneId, urlInfo.token, sessionId, loadSceneById]);

  // Connect WebSocket for the session
  useEffect(() => {
    const disconnect = connectRealtime(sessionId, (event: RealtimeEvent) => {
      if (event.type === "text_delta") {
        // Streaming — append to current agent message
        if (!streamingIdRef.current) {
          const id = nextId();
          streamingIdRef.current = id;
          setChatMessages((prev) => [...prev, { id, role: "agent", text: event.delta, isStreaming: true }]);
        } else {
          const id = streamingIdRef.current;
          setChatMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, text: m.text + event.delta } : m)),
          );
        }
        // Also stream to narrative overlay for viewer interactions
        streamingBuffer.current += event.delta;
        setIsStreaming(true);
        setNarrativeLines([streamingBuffer.current]);

      } else if (event.type === "text_done") {
        if (streamingIdRef.current) {
          const id = streamingIdRef.current;
          streamingIdRef.current = null;
          setChatMessages((prev) => {
            // If empty (e.g. agent.prompt() threw before generating text), remove placeholder
            if (!event.text) return prev.filter((m) => m.id !== id);
            return prev.map((m) => (m.id === id ? { ...m, text: event.text, isStreaming: false } : m));
          });
        }
        setIsStreaming(false);
        setIsTyping(false);
        setNarrativeLines(event.text ? [event.text] : []);
        streamingBuffer.current = "";
        if (event.text) setTimeout(() => setNarrativeLines([]), 8000);

      } else if (event.type === "scene_created") {
        // New scene generated — load it in the viewer and show a card
        const card: SceneCard = { sceneId: event.sceneId, title: event.title, viewUrl: event.viewUrl };
        setSceneCards((prev) => {
          // Avoid duplicate cards for the same scene
          if (prev.some((c) => c.sceneId === event.sceneId)) return prev;
          return [...prev, card];
        });
        // Auto-load the new scene
        loadSceneById(event.sceneId, { session: sessionId });

      } else if (event.type === "scene_updated" && sceneRef.current && event.sceneId === sceneRef.current.sceneId) {
        const prevObjects = sceneRef.current.sceneData.objects;
        fetchScene(event.sceneId, { session: sessionId }).then((s) => {
          setScene(s);
          sceneRef.current = s;
          const prevIds = new Set(prevObjects.map((o) => o.objectId));
          const newIds = new Set(s.sceneData.objects.map((o) => o.objectId));
          const loadFn = (window as Record<string, unknown>).__loadSceneProp as
            | ((obj: SceneObject) => Promise<void>)
            | undefined;
          const removeFn = (window as Record<string, unknown>).__removeSceneProp as
            | ((objectId: string) => void)
            | undefined;
          const loadNpcFn = (window as Record<string, unknown>).__loadSceneNpc as
            | ((obj: SceneObject) => Promise<void>)
            | undefined;
          const removeNpcFn = (window as Record<string, unknown>).__removeSceneNpc as
            | ((objectId: string) => void)
            | undefined;
          // Remove props that no longer exist
          if (removeFn) {
            for (const obj of prevObjects) {
              if (obj.type === "prop" && !newIds.has(obj.objectId)) {
                removeFn(obj.objectId);
              }
            }
          }
          // Remove NPCs that no longer exist
          if (removeNpcFn) {
            for (const obj of prevObjects) {
              if (obj.type === "npc" && !newIds.has(obj.objectId)) {
                removeNpcFn(obj.objectId);
              }
            }
          }
          // Load newly added props
          if (loadFn) {
            for (const obj of s.sceneData.objects) {
              if (obj.type === "prop" && typeof obj.metadata.modelUrl === "string" && !prevIds.has(obj.objectId)) {
                loadFn(obj).catch(console.warn);
              }
            }
          }
          // Load newly added NPCs
          if (loadNpcFn) {
            for (const obj of s.sceneData.objects) {
              if (obj.type === "npc" && obj.interactable && !prevIds.has(obj.objectId)) {
                loadNpcFn(obj).catch(console.warn);
              }
            }
          }
        }).catch(console.error);

      } else if (event.type === "npc_speech") {
        // Ignore events from a different scene (e.g. heartbeat for a non-active scene)
        if (event.sceneId && sceneRef.current && event.sceneId !== sceneRef.current.sceneId) return;
        // Feed into the chat overlay if open, otherwise show the legacy speech bubble
        setNpcChatPending(false);
        setNpcChatHistory((prev) => [...prev, { role: "npc", text: event.text }]);
        // Also keep the speech bubble for non-overlay contexts (ViewerCanvas scenes)
        if (npcSpeechTimerRef.current) clearTimeout(npcSpeechTimerRef.current);
        setNpcSpeech({ npcId: event.npcId, npcName: event.npcName, text: event.text });
        npcSpeechTimerRef.current = setTimeout(() => setNpcSpeech(null), 8000);

      } else if (event.type === "npc_move") {
        if (event.sceneId && sceneRef.current && event.sceneId !== sceneRef.current.sceneId) return;
        const moveNpc = (window as unknown as Record<string, unknown>).__moveNpc as
          | ((id: string, pos: { x: number; y: number; z: number }) => void)
          | undefined;
        moveNpc?.(event.npcId, event.position);

      } else if (event.type === "npc_emote") {
        if (event.sceneId && sceneRef.current && event.sceneId !== sceneRef.current.sceneId) return;
        const emoteNpc = (window as unknown as Record<string, unknown>).__emoteNpc as
          | ((id: string, animation: string) => void)
          | undefined;
        emoteNpc?.(event.npcId, event.animation);

      } else if (event.type === "error") {
        setNarrativeLines([`Error: ${event.message}`]);
        setIsStreaming(false);
        setIsTyping(false);
        // Also show errors in the chat so they're visible even without a loaded scene
        setChatMessages((prev) => [...prev, { id: nextId(), role: "agent", text: `Error: ${event.message}` }]);
      }
    });
    return disconnect;
  }, [sessionId]);

  // Chat send
  const handleSend = useCallback(
    async (text: string, images?: PendingImage[]) => {
      const userMsg: ChatMessage = {
        id: nextId(),
        role: "user",
        text,
        images: images?.map((img) => img.dataUrl),
      };
      setChatMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);
      streamingBuffer.current = "";
      const apiImages = images?.map((img) => ({ base64: img.base64, mimeType: img.mimeType }));
      const playerPosition = (window as unknown as Record<string, unknown>).__playerPosition as
        | { x: number; y: number; z: number }
        | undefined;
      const rawClick = (window as unknown as Record<string, unknown>).__clickPosition as
        | { x: number; y: number; z: number; ts: number }
        | undefined;
      const clickPosition = rawClick && Date.now() - rawClick.ts < 30_000
        ? { x: rawClick.x, y: rawClick.y, z: rawClick.z }
        : undefined;
      try {
        await postChat({ sessionId, userId: userId.current, text, images: apiImages, playerPosition, clickPosition });
      } catch (err) {
        setIsTyping(false);
        const msg = err instanceof Error ? err.message : "Failed to send";
        setChatMessages((prev) => [...prev, { id: nextId(), role: "agent", text: `Error: ${msg}` }]);
      }
    },
    [sessionId],
  );

  // Scene card click — load scene and collapse drawer
  const handleSceneSelect = useCallback((card: SceneCard) => {
    loadSceneById(card.sceneId, { session: sessionId });
  }, [sessionId, loadSceneById]);

  // Slash-command handler
  const handleCommand = useCallback(async (cmd: string) => {
    setChatMessages((prev) => [...prev, { id: nextId(), role: "user", text: cmd }]);
    const [verb, ...argParts] = cmd.trim().split(/\s+/);
    const arg = argParts.join(" ");

    if (verb === "/list" || verb === "/find") {
      try {
        const all = await fetchSceneList(sessionId);
        const marble = all
          .filter((s) => s.provider === "marble" && s.status === "ready")
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const q = arg.toLowerCase();
        const scenes = verb === "/find" && q ? marble.filter((s) => fuzzyMatch(s.title.toLowerCase(), q)) : marble;
        const text = verb === "/find" && q
          ? (scenes.length > 0 ? `找到 ${scenes.length} 个场景` : `未找到匹配 "${arg}" 的场景`)
          : `${scenes.length} 个场景`;
        setChatMessages((prev) => [...prev, { id: nextId(), role: "command_result" as const, text, scenes }]);
      } catch (err) {
        setChatMessages((prev) => [
          ...prev,
          { id: nextId(), role: "agent", text: `Error: ${err instanceof Error ? err.message : "Failed to fetch scenes"}` },
        ]);
      }
    }
  }, [sessionId]);

  // Delete scene from /list result
  const handleDeleteScene = useCallback(async (sceneId: string) => {
    try {
      await deleteScene(sceneId, sessionId);
      // Remove from every command_result message that contains this scene
      setChatMessages((prev) =>
        prev.map((m) =>
          m.role === "command_result" && m.scenes
            ? { ...m, scenes: m.scenes.filter((s) => s.sceneId !== sceneId), text: `${(m.scenes.length - 1)} 个场景` }
            : m,
        ),
      );
      // If the deleted scene is currently loaded, clear it
      if (sceneRef.current?.sceneId === sceneId) {
        setScene(null);
        sceneRef.current = null;
        history.pushState(null, "", "/");
      }
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { id: nextId(), role: "agent", text: `Error: ${err instanceof Error ? err.message : "Failed to delete scene"}` },
      ]);
    }
  }, [sessionId]);

  // Object interaction (existing flow)
  const handleObjectClick = useCallback(
    (objectId: string, name: string, interactable: boolean) => {
      setSelected({ objectId, name, interactable });
    },
    [],
  );

  const handleAction = useCallback(
    async (action: string) => {
      if (!selected || !scene) return;
      setSelected(null);
      setNarrativeLines([]);
      setIsStreaming(true);
      streamingBuffer.current = "";
      try {
        await postInteract({ sessionId, sceneId: scene.sceneId, objectId: selected.objectId, action });
      } catch (err) {
        setNarrativeLines([err instanceof Error ? err.message : "Interaction failed"]);
        setIsStreaming(false);
      }
    },
    [selected, scene, sessionId],
  );

  const handleViewpointSelect = useCallback((vp: Viewpoint) => {
    setActiveViewpoint(vp);
  }, []);

  const handleSplatInteract = useCallback(
    async (objectId: string, action: string) => {
      if (!scene) return;
      // Route NPC interactions to the dedicated NPC chat overlay
      const obj = scene.sceneData.objects.find((o) => o.objectId === objectId);
      if (obj?.type === "npc") {
        // Release pointer lock so the user can type in the chat overlay
        if (document.pointerLockElement) document.exitPointerLock();
        const npcName = obj.name;
        // Open overlay fresh; clear any previous history for this NPC
        setNpcChatTarget({ objectId, name: npcName });
        setNpcChatHistory([]);
        setNpcChatPending(false);
        // action is the interactionHint or "你好" — skip auto-send so the user types first
        return;
      }
      setNarrativeLines([]);
      setIsStreaming(true);
      streamingBuffer.current = "";
      try {
        await postInteract({ sessionId, sceneId: scene.sceneId, objectId, action });
      } catch (err) {
        setNarrativeLines([err instanceof Error ? err.message : "Interaction failed"]);
        setIsStreaming(false);
      }
    },
    [scene, sessionId],
  );

  const sendNpcMessage = useCallback(
    (text: string) => {
      if (!scene || !npcChatTarget) return;
      setNpcChatHistory((prev) => [...prev, { role: "user", text }]);
      setNpcChatPending(true);
      const playerPosition = (window as unknown as Record<string, unknown>).__playerPosition as
        | { x: number; y: number; z: number }
        | undefined;
      postNpcInteract({
        sessionId,
        sceneId: scene.sceneId,
        npcObjectId: npcChatTarget.objectId,
        userText: text,
        playerPosition,
      }).catch((err) => {
        setNpcChatPending(false);
        setNpcChatHistory((prev) => [...prev, { role: "npc", text: `(出错了: ${err instanceof Error ? err.message : "未知错误"})` }]);
      });
    },
    [scene, sessionId, npcChatTarget],
  );

  const handleNpcApproach = useCallback(
    (objectId: string, name: string) => {
      if (!scene) return;
      const key = `${scene.sceneId}:${objectId}`;
      // Open chat overlay for any new NPC (even re-approaches after leaving)
      if (document.pointerLockElement) document.exitPointerLock();
      setNpcChatTarget({ objectId, name });
      setNpcChatHistory([]);
      setNpcChatPending(false);
      // Trigger greeting only once per session
      if (greetedNpcsRef.current.has(key)) return;
      greetedNpcsRef.current.add(key);
      const playerPosition = (window as unknown as Record<string, unknown>).__playerPosition as
        | { x: number; y: number; z: number }
        | undefined;
      postNpcGreet({ sessionId, sceneId: scene.sceneId, npcObjectId: objectId, playerPosition }).catch(
        (err: unknown) => { console.error("[npc-greet]", err); },
      );
    },
    [scene, sessionId],
  );

  const handleNpcLeave = useCallback(() => {
    setNpcChatTarget(null);
  }, []);

  // Bottom padding to keep 3D canvas above the chat drawer (peek = 72px)
  const PEEK_HEIGHT = 72;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* 3D viewport */}
      <div style={{ position: "absolute", inset: 0, bottom: PEEK_HEIGHT }}>
        {sceneError ? (
          <div style={{ color: "#f88", fontFamily: "monospace", padding: 24, background: "#111", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {sceneError}
          </div>
        ) : scene ? (
          scene.sceneData.splatUrl ? (
            <SplatViewer
              splatUrl={scene.sceneData.splatUrl}
              colliderMeshUrl={scene.sceneData.colliderMeshUrl ? `/collider/${scene.sceneId}` : undefined}
              sceneObjects={scene.sceneData.objects}
              viewpoints={scene.sceneData.viewpoints}
              splatGroundOffset={scene.sceneData.splatGroundOffset}
              onInteract={handleSplatInteract}
              onNpcApproach={handleNpcApproach}
              onNpcLeave={handleNpcLeave}
              npcSpeech={npcSpeech}
              onPlacementRequest={(text) => { void handleSend(text); }}
              onAddProp={(entry, _objectId) => {
                if (!scene) return;
                const playerPosition = (window as unknown as Record<string, unknown>).__playerPosition as
                  | { x: number; y: number; z: number }
                  | undefined;
                addSceneProp(scene.sceneId, sessionId, {
                  name: entry.id,
                  description: entry.tags.join(", "),
                  modelUrl: entry.url,
                  scale: entry.scale,
                  mass: 10,
                  placement: "near_camera",
                  playerPosition,
                }).catch(console.warn);
              }}
            />
          ) : scene.providerRef.provider === "marble" ? (
            // Marble scenes always use SplatViewer via SPZ proxy.
            // If splatUrl is missing the scene was generated before that change or
            // is still generating — show a neutral waiting state.
            <div style={{ position: "relative", width: "100%", height: "100%", background: "#0a0a14", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <StarField />
              <div style={{ color: "rgba(200,220,255,0.7)", fontFamily: "system-ui, sans-serif", fontSize: 14, letterSpacing: 0.5, position: "relative", zIndex: 1 }}>
                {scene.status === "generating" ? "Scene generating…" : "Scene not available (no splat data)"}
              </div>
            </div>
          ) : (
            <ViewerCanvas
                sceneData={scene.sceneData}
                onObjectClick={handleObjectClick}
                activeViewpoint={activeViewpoint}
                sceneId={scene.sceneId}
                onScreenshot={uploadScreenshot}
              />
          )
        ) : (
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <StarField />
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              {/* Aurora glow */}
              <div style={{
                position: "absolute",
                width: 360,
                height: 180,
                borderRadius: "50%",
                background: "radial-gradient(ellipse, rgba(100,60,220,0.18) 0%, rgba(40,80,200,0.10) 50%, transparent 80%)",
                filter: "blur(32px)",
              }} />
              <div style={{
                fontSize: 36,
                fontWeight: 300,
                fontFamily: "Georgia, serif",
                letterSpacing: 3,
                marginBottom: 14,
                background: "linear-gradient(135deg, #c8b0ff 0%, #a8d4ff 60%, #e0ccff 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}>
                Scratch World
              </div>
              <div style={{ fontSize: 15, color: "rgba(170,185,235,0.6)", fontFamily: "system-ui, -apple-system, sans-serif", letterSpacing: 0.5 }}>
                描述一个你想探索的世界
              </div>
            </div>
          </div>
        )}

        {scene && (
          <>
            <ViewpointBar viewpoints={scene.sceneData.viewpoints} onSelect={handleViewpointSelect} />
            <NarrativeOverlay lines={narrativeLines} isStreaming={isStreaming} />
            {selected && (
              <InteractionPrompt
                objectName={selected.name}
                interactionHint={scene.sceneData.objects.find((o) => o.objectId === selected.objectId)?.interactionHint}
                onAction={handleAction}
                onDismiss={() => setSelected(null)}
              />
            )}
          </>
        )}
      </div>

      {/* NPC button — top-right, shown when a scene is loaded */}
      {scene && (
        <button
          onClick={() => setShowNpcDrawer((v) => !v)}
          style={{
            position: "fixed", top: 16, right: 16,
            background: showNpcDrawer ? "rgba(120,80,255,0.4)" : "rgba(20,15,40,0.75)",
            border: "1px solid rgba(140,100,255,0.35)",
            borderRadius: 8, padding: "7px 14px",
            color: "rgba(200,220,255,0.9)", fontSize: 13,
            cursor: "pointer", zIndex: 105,
            backdropFilter: "blur(8px)",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          NPC
        </button>
      )}

      {/* NPC management drawer */}
      <NpcDrawer
        open={showNpcDrawer}
        onClose={() => setShowNpcDrawer(false)}
        scene={scene}
        sessionId={sessionId}
        onNpcAdded={() => { if (scene) loadSceneById(scene.sceneId, { session: sessionId }); }}
        onNpcUpdated={() => { if (scene) loadSceneById(scene.sceneId, { session: sessionId }); }}
        onNpcDeleted={() => { if (scene) loadSceneById(scene.sceneId, { session: sessionId }); }}
      />

      {/* NPC chat overlay — shown when interacting with an NPC */}
      {npcChatTarget && (
        <div style={{ position: "absolute", inset: 0, bottom: PEEK_HEIGHT, pointerEvents: "none", zIndex: 115 }}>
          <div style={{ position: "relative", width: "100%", height: "100%", pointerEvents: "none" }}>
            <div style={{ pointerEvents: "auto" }}>
              <NpcChatOverlay
                npcName={npcChatTarget.name}
                history={npcChatHistory}
                pending={npcChatPending}
                onSend={sendNpcMessage}
                onClose={() => {
                  setNpcChatTarget(null);
                  setNpcChatHistory([]);
                  setNpcChatPending(false);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Chat drawer — always visible */}
      <ChatDrawer
        messages={chatMessages}
        sceneCards={sceneCards}
        isTyping={isTyping}
        onSend={handleSend}
        onSceneSelect={handleSceneSelect}
        onCommand={handleCommand}
        onDeleteScene={handleDeleteScene}
      />
    </div>
  );
}
