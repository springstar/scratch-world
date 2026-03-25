import { useState, useEffect, useCallback, useRef } from "react";
import { ViewerCanvas } from "./components/ViewerCanvas.js";
import { MarbleViewer } from "./components/MarbleViewer.js";
import { NarrativeOverlay } from "./components/NarrativeOverlay.js";
import { ViewpointBar } from "./components/ViewpointBar.js";
import { InteractionPrompt } from "./components/InteractionPrompt.js";
import { StarField } from "./components/StarField.js";
import { ChatDrawer } from "./components/ChatDrawer.js";
import type { ChatMessage, SceneCard } from "./components/ChatDrawer.js";
import { fetchScene, postInteract, postChat, connectRealtime } from "./api.js";
import type { SceneResponse, Viewpoint, RealtimeEvent } from "./types.js";

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

export function App() {
  const userId = useRef(getOrCreateUserId());
  const sessionId = `web:${userId.current}`;

  const [scene, setScene] = useState<SceneResponse | null>(null);
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

  // Load initial scene from URL
  useEffect(() => {
    if (!urlInfo.sceneId) return;
    fetchScene(urlInfo.sceneId, { token: urlInfo.token ?? undefined, session: sessionId })
      .then(setScene)
      .catch((err: unknown) => setSceneError(err instanceof Error ? err.message : "Failed to load scene"));
  }, [urlInfo.sceneId, urlInfo.token, sessionId]);

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
          setChatMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: event.text, isStreaming: false } : m)));
          streamingIdRef.current = null;
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
        fetchScene(event.sceneId, { session: sessionId })
          .then((s) => {
            setScene(s);
            history.pushState(null, "", `/scene/${event.sceneId}?session=${sessionId}`);
          })
          .catch(console.error);

      } else if (event.type === "scene_updated" && scene && event.sceneId === scene.sceneId) {
        fetchScene(event.sceneId, { session: sessionId }).then(setScene).catch(console.error);

      } else if (event.type === "error") {
        setNarrativeLines([`Error: ${event.message}`]);
        setIsStreaming(false);
        setIsTyping(false);
      }
    });
    return disconnect;
  }, [sessionId, scene]);

  // Chat send
  const handleSend = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = { id: nextId(), role: "user", text };
      setChatMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);
      streamingBuffer.current = "";
      try {
        await postChat({ sessionId, userId: userId.current, text });
      } catch (err) {
        setIsTyping(false);
        const msg = err instanceof Error ? err.message : "Failed to send";
        setChatMessages((prev) => [...prev, { id: nextId(), role: "agent", text: `Error: ${msg}` }]);
      }
    },
    [sessionId],
  );

  // Scene card click
  const handleSceneSelect = useCallback((card: SceneCard) => {
    fetchScene(card.sceneId, { session: sessionId })
      .then((s) => {
        setScene(s);
        history.pushState(null, "", `/scene/${card.sceneId}?session=${sessionId}`);
      })
      .catch(console.error);
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
          scene.providerRef.provider === "marble" && scene.providerRef.viewUrl ? (
            <MarbleViewer marbleUrl={scene.providerRef.viewUrl} sceneData={scene.sceneData} />
          ) : (
            <ViewerCanvas sceneData={scene.sceneData} onObjectClick={handleObjectClick} activeViewpoint={activeViewpoint} />
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
              <div style={{ fontSize: 28, fontWeight: 300, color: "rgba(200,210,255,0.8)", fontFamily: "Georgia, serif", marginBottom: 12, letterSpacing: 1 }}>
                Scratch World
              </div>
              <div style={{ fontSize: 15, color: "rgba(150,170,220,0.5)", fontFamily: "system-ui, -apple-system, sans-serif" }}>
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

      {/* Chat drawer — always visible */}
      <ChatDrawer
        messages={chatMessages}
        sceneCards={sceneCards}
        isTyping={isTyping}
        onSend={handleSend}
        onSceneSelect={handleSceneSelect}
      />
    </div>
  );
}
