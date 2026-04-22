import { useState, useEffect, useCallback, useRef } from "react";
import { ViewerCanvas } from "./components/ViewerCanvas.js";
import { NpcDrawer } from "./components/NpcDrawer.js";
import { NpcChatOverlay } from "./components/NpcChatOverlay.js";
import type { NpcChatMessage } from "./components/NpcChatOverlay.js";
import { SplatViewer } from "./components/SplatViewer.js";
import type { CameraAPI } from "./components/SplatViewer.js";
import { NarrativeOverlay } from "./components/NarrativeOverlay.js";
import { uploadScreenshot } from "./api.js";
import { ViewpointBar } from "./components/ViewpointBar.js";
import { InteractionPrompt } from "./components/InteractionPrompt.js";
import { StarField } from "./components/StarField.js";
import { ChatDrawer } from "./components/ChatDrawer.js";
import type { ChatMessage, SceneCard, PendingImage } from "./components/ChatDrawer.js";
import { fetchScene, postInteract, postNpcInteract, postNpcGreet, postChat, connectRealtime, addSceneProp, addSceneNpc, fetchSceneList, deleteScene, patchSceneObjectPosition, addScenePortal } from "./api.js";
import type { SceneResponse, Viewpoint, RealtimeEvent, SceneObject, DisplayConfig, ResourceNeed, ResourceChoice } from "./types.js";
import type { PendingNpc, GeneratedNpcModel } from "./components/NpcDrawer.js";
import { PropDrawer } from "./components/PropDrawer.js";
import type { PendingProp, GeneratedProp } from "./components/PropDrawer.js";
import { PortalDrawer } from "./components/PortalDrawer.js";
import { BehaviorOverlay } from "./components/BehaviorOverlay.js";
import { PropInteractionPanel } from "./components/PropInteractionPanel.js";
import { ResourcePickerPanel } from "./components/ResourcePickerPanel.js";
import { PositionPicker } from "./components/PositionPicker.js";
import { resolveVideoDisplay } from "./behaviors/video-player-client.js";
import { CameraPanel } from "./components/CameraPanel.js";

function buildScriptContext(scene: SceneResponse, objectId: string): ScriptContext {
  const obj = scene.sceneData.objects.find((o) => o.objectId === objectId);
  const pos = obj?.position ?? { x: 0, y: 0, z: 0 };
  const meta = (obj?.metadata ?? {}) as Record<string, unknown>;
  const displayY = typeof meta.displayY === "number" ? meta.displayY : 1.3;
  const targetH = typeof meta.targetHeight === "number" ? meta.targetHeight : 0.9;
  const displayHeight = targetH;
  const displayWidth = Math.round(displayHeight * (16 / 9) * 100) / 100;
  return { objectPosition: { x: pos.x, y: pos.y, z: pos.z }, displayY, displayWidth, displayHeight };
}
import { runScript, type ScriptContext } from "./behaviors/world-api.js";

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
  // World speech feed — queue of recent NPC speeches shown as head-top bubbles
  const [speechFeed, setSpeechFeed] = useState<Array<{ id: string; npcId: string; npcName: string; text: string }>>([]);
  const [showNpcDrawer, setShowNpcDrawer] = useState(false);
  const [pendingNpc, setPendingNpc] = useState<PendingNpc | null>(null);
  const [showPropDrawer, setShowPropDrawer] = useState(false);
  const [pendingProp, setPendingProp] = useState<PendingProp | null>(null);

  // Portal state
  const [showPortalDrawer, setShowPortalDrawer] = useState(false);
  const [pendingPortal, setPendingPortal] = useState<{ name?: string; targetSceneId?: string; targetSceneName?: string } | null>(null);
  const [portalScenePicker, setPortalScenePicker] = useState(false);

  // Behavior skill overlay
  const [behaviorDisplay, setBehaviorDisplay] = useState<DisplayConfig | null>(null);

  // Resource picker — shown when code-gen identifies needed textures/assets before generating
  const [resourcePicker, setResourcePicker] = useState<{
    needs: ResourceNeed[];
    title: string;
    // Context needed to re-fire the interact call after user confirms
    objectId: string;
    action: string;
    skillMeta: Record<string, unknown>;
  } | null>(null);

  // Proximity-triggered prop interaction panel (e.g. TV remote control)
  const [activePropPanel, setActivePropPanel] = useState<{
    objectId: string;
    name: string;
    skillName: string;
    skillConfig: Record<string, unknown>;
  } | null>(null);

  // Position picker — shown when agent wants user to confirm/correct an estimated position,
  // OR when the viewer wants user to pick a placement position before click-to-place.
  // pickerId is set for agent-driven cases (server Promise waits for POST /confirm-position).
  // onConfirmLocal is set for viewer-driven cases (no server roundtrip needed).
  // onSkipLocal is set for viewer-driven cases where skip = cancel (no fallback position).
  const [positionPicker, setPositionPicker] = useState<{
    pickerId?: string;
    panoUrl: string;
    estimatedPos: { x: number; y: number; z: number };
    objectName: string;
    sceneId: string;
    onConfirmLocal?: (pos: { x: number; y: number; z: number }) => void;
    onSkipLocal?: () => void;
  } | null>(null);

  // Toast from WorldAPI scripts
  const [scriptToast, setScriptToast] = useState<string | null>(null);
  // HTML display panel from WorldAPI world.setDisplay(html)
  const [scriptDisplay, setScriptDisplay] = useState<string | null>(null);

  // Script mesh drag-to-place — active while user drags to position new meshes.
  // frozen=true: mesh is placed (ESC pressed), panel visible for confirm, tracking stopped.
  const [scriptMeshPlacement, setScriptMeshPlacement] = useState<{
    meshes: Array<import("three").Object3D>;
    objectId: string;
    sceneId: string;
    cachedCode: string;
    frozen?: boolean;
  } | null>(null);

  // Camera tool
  const [showCamera, setShowCamera] = useState(false);
  const cameraAPIRef = useRef<CameraAPI | null>(null);

  // Prop library — persisted to localStorage so it survives page reloads
  const [generatedProps, setGeneratedProps] = useState<GeneratedProp[]>(() => {
    try {
      const raw = localStorage.getItem("scratch_world_prop_library");
      return raw ? (JSON.parse(raw) as GeneratedProp[]) : [];
    } catch {
      return [];
    }
  });

  const addGeneratedProp = useCallback((prop: GeneratedProp) => {
    setGeneratedProps((prev) => {
      const next = [prop, ...prev];
      try { localStorage.setItem("scratch_world_prop_library", JSON.stringify(next)); } catch { /* non-fatal */ }
      return next;
    });
  }, []);

  // Generated NPC model library — persisted to localStorage
  const [generatedNpcModels, setGeneratedNpcModels] = useState<GeneratedNpcModel[]>(() => {
    try {
      const raw = localStorage.getItem("scratch_world_npc_model_library");
      return raw ? (JSON.parse(raw) as GeneratedNpcModel[]) : [];
    } catch {
      return [];
    }
  });

  const addGeneratedNpcModel = useCallback((m: GeneratedNpcModel) => {
    setGeneratedNpcModels((prev) => {
      const next = [m, ...prev];
      try { localStorage.setItem("scratch_world_npc_model_library", JSON.stringify(next)); } catch { /* non-fatal */ }
      return next;
    });
  }, []);

  // NPC chat session
  const [npcChatTarget, setNpcChatTarget] = useState<{ objectId: string; name: string } | null>(null);
  const npcChatTargetRef = useRef<{ objectId: string; name: string } | null>(null);
  npcChatTargetRef.current = npcChatTarget;
  const [npcChatHistory, setNpcChatHistory] = useState<NpcChatMessage[]>([]);
  const [npcChatPending, setNpcChatPending] = useState(false);
  // Track which NPCs have already greeted this session (key: sceneId:npcId)
  const greetedNpcsRef = useRef<Set<string>>(new Set());

  // Load a scene and jump to its first viewpoint
  const loadSceneById = useCallback(
    (sceneId: string, opts?: { token?: string; session?: string }) => {
      const prevObjects = sceneRef.current?.sceneData.objects ?? [];
      fetchScene(sceneId, opts)
        .then((s) => {
          setScene(s);
          sceneRef.current = s;
          setActiveViewpoint(s.sceneData.viewpoints[0] ?? null);
          greetedNpcsRef.current.clear();
          history.pushState(null, "", `/scene/${sceneId}?session=${sessionId}`);

          // Inject newly added objects into the live physics world so a full
          // page reload is not required after placement.
          const prevIds = new Set(prevObjects.map((o) => o.objectId));
          const loadPropFn = (window as unknown as Record<string, unknown>).__loadSceneProp as
            | ((obj: SceneObject) => Promise<void>) | undefined;
          const loadNpcFn = (window as unknown as Record<string, unknown>).__loadSceneNpc as
            | ((obj: SceneObject) => Promise<void>) | undefined;
          const loadPortalFn = (window as unknown as Record<string, unknown>).__loadScenePortal as
            | ((obj: SceneObject) => void) | undefined;
          for (const obj of s.sceneData.objects) {
            if (prevIds.has(obj.objectId)) continue;
            if (obj.type === "prop" && typeof obj.metadata.modelUrl === "string" && obj.metadata.modelUrl !== "") {
              loadPropFn?.(obj).catch(console.warn);
            } else if (obj.type === "npc" && obj.interactable) {
              loadNpcFn?.(obj).catch(console.warn);
            } else if (obj.type === "portal") {
              loadPortalFn?.(obj);
            }
          }
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

  // Auto-run scripts for props that have skill.config.autoRun = true
  useEffect(() => {
    if (!scene) return;
    const autoRunProps = scene.sceneData.objects.filter((o) => {
      const skill = o.metadata?.skill as Record<string, unknown> | undefined;
      const cfg = skill?.config as Record<string, unknown> | undefined;
      return cfg?.autoRun === true && typeof cfg?.cachedCode === "string";
    });
    if (autoRunProps.length === 0) return;
    // Wait for worldAPI to be ready (SplatViewer mounts async)
    let attempts = 0;
    const timer = setInterval(() => {
      const worldAPI = (window as unknown as Record<string, unknown>).__worldAPI;
      if (!worldAPI) {
        if (++attempts > 30) clearInterval(timer);
        return;
      }
      clearInterval(timer);
      const api = worldAPI as { scene: { children: Array<{ type?: string; renderOrder?: number; material?: { transparent?: boolean; needsUpdate?: boolean } | Array<{ transparent?: boolean; needsUpdate?: boolean }>; userData?: Record<string, unknown> }> } };
      for (const obj of autoRunProps) {
        const cfg = (obj.metadata.skill as Record<string, unknown>).config as Record<string, unknown>;
        const code = String(cfg.cachedCode);
        // Skip if already ran for this prop
        const alreadyRan = api.scene.children.some((c) => c.userData?.scriptObjectId === obj.objectId);
        if (alreadyRan) continue;
        const countBefore = api.scene.children.length;
        runScript(code, worldAPI as Parameters<typeof runScript>[1], buildScriptContext(scene, obj.objectId));        for (let i = countBefore; i < api.scene.children.length; i++) {
          const child = api.scene.children[i];
          if (child.type === "Mesh") {
            if (child.renderOrder === 0) child.renderOrder = 1;
            const mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
            for (const m of mats) { if (!m.transparent) { m.transparent = true; m.needsUpdate = true; } }
          }
          child.userData = { ...(child.userData ?? {}), scriptObjectId: obj.objectId };
        }
      }
    }, 500);
    return () => clearInterval(timer);
  }, [scene]);

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
          const loadFn = (window as unknown as Record<string, unknown>).__loadSceneProp as
            | ((obj: SceneObject) => Promise<void>)
            | undefined;
          const removeFn = (window as unknown as Record<string, unknown>).__removeSceneProp as
            | ((objectId: string) => void)
            | undefined;
          const loadNpcFn = (window as unknown as Record<string, unknown>).__loadSceneNpc as
            | ((obj: SceneObject) => Promise<void>)
            | undefined;
          const removeNpcFn = (window as unknown as Record<string, unknown>).__removeSceneNpc as
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
              if (obj.type === "prop" && typeof obj.metadata.modelUrl === "string" && obj.metadata.modelUrl !== "" && !prevIds.has(obj.objectId)) {
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
        // Only inject into chat overlay if this NPC is the current chat target
        if (npcChatTargetRef.current?.objectId === event.npcId) {
          setNpcChatPending(false);
          setNpcChatHistory((prev) => [...prev, { role: "npc", text: event.text, npcName: event.npcName }]);
        }
        // All NPC speech goes to the world speech feed (head-top bubbles)
        const feedId = `${event.npcId}_${Date.now()}`;
        setSpeechFeed((prev) => [...prev.slice(-4), { id: feedId, npcId: event.npcId, npcName: event.npcName, text: event.text }]);
        setTimeout(() => setSpeechFeed((prev) => prev.filter((e) => e.id !== feedId)), 8000);

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

      } else if (event.type === "position_picker") {
        setPositionPicker({
          pickerId: event.pickerId,
          panoUrl: event.panoUrl,
          estimatedPos: event.estimatedPos,
          objectName: event.objectName,
          sceneId: event.sceneId,
        });
      }
    });
    return disconnect;
  }, [sessionId]);

  // world:toast events fired by WorldAPI scripts
  useEffect(() => {
    const handleToast = (e: Event) => {
      const { text, durationMs = 3000 } = (e as CustomEvent<{ text: string; durationMs?: number }>).detail;
      setScriptToast(text);
      setTimeout(() => setScriptToast(null), durationMs);
    };
    window.addEventListener("world:toast", handleToast);
    return () => window.removeEventListener("world:toast", handleToast);
  }, []);

  // C key toggles camera panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "c" || e.key === "C") setShowCamera((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // world:display events fired by WorldAPI world.setDisplay(html)
  useEffect(() => {
    const handleDisplay = (e: Event) => {
      const { html } = (e as CustomEvent<{ html: string | null }>).detail;
      setScriptDisplay(html);
    };
    window.addEventListener("world:display", handleDisplay);
    return () => window.removeEventListener("world:display", handleDisplay);
  }, []);

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
      // Safety timeout: if agent_done never arrives (SSE drop), unblock the input after 90s
      const typingTimeout = setTimeout(() => {
        setIsTyping(false);
        setIsStreaming(false);
      }, 90_000);
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
        await postChat({ sessionId, userId: userId.current, text, sceneId: scene?.sceneId, images: apiImages, playerPosition, clickPosition });
      } catch (err) {
        setIsTyping(false);
        const msg = err instanceof Error ? err.message : "Failed to send";
        setChatMessages((prev) => [...prev, { id: nextId(), role: "agent", text: `Error: ${msg}` }]);
      } finally {
        clearTimeout(typingTimeout);
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
        const all = await fetchSceneList();
        const ready = all
          .filter((s) => s.status === "ready")
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const q = arg.toLowerCase();
        const scenes = verb === "/find" && q ? ready.filter((s) => fuzzyMatch(s.title.toLowerCase(), q)) : ready;
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
        const result = await postInteract({ sessionId, sceneId: scene.sceneId, objectId: selected.objectId, action });
        if (result.display) {
          setIsStreaming(false);
          setBehaviorDisplay(result.display);
        }
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

  const runScriptAndCalibrate = useCallback(
    (code: string, objectId: string, sceneId: string) => {
      const worldAPI = (window as unknown as Record<string, unknown>).__worldAPI;
      if (!worldAPI || !scene) return;
      const api = worldAPI as { scene: { children: Array<{ type?: string; renderOrder?: number; position: { set(x: number, y: number, z: number): void; x: number; y: number; z: number }; material?: { transparent?: boolean; needsUpdate?: boolean } | Array<{ transparent?: boolean; needsUpdate?: boolean }>; userData?: Record<string, unknown> }> } };
      // If meshes from this prop already exist, show calibrator in frozen mode
      const existingObjs = api.scene.children.filter((c) => c.userData?.scriptObjectId === objectId);
      if (existingObjs.length > 0) {
        const meshes = existingObjs.filter((c) => c.type === "Mesh" || c.type === "Group");
        if (meshes.length > 0) setScriptMeshPlacement({ meshes: meshes as Array<import("three").Object3D>, objectId, sceneId, cachedCode: code, frozen: true });
        return;
      }
      const countBefore = api.scene.children.length;
      const err = runScript(code, worldAPI as Parameters<typeof runScript>[1], buildScriptContext(scene, objectId));
      if (!err) {
        const newObjs: Array<{ position: { set(x: number, y: number, z: number): void; x: number; y: number; z: number } }> = [];
        for (let i = countBefore; i < api.scene.children.length; i++) {
          const child = api.scene.children[i];
          if (child.type === "Mesh") {
            if (child.renderOrder === 0) child.renderOrder = 1;
            const mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
            for (const m of mats) { if (!m.transparent) { m.transparent = true; m.needsUpdate = true; } }
          }
          // Tag all new objects (Mesh, Group, Points, etc.) with the prop's objectId
          child.userData = { ...(child.userData ?? {}), scriptObjectId: objectId };
          if (child.type === "Mesh" || child.type === "Group") newObjs.push(child);
        }
        if (newObjs.length > 0) {
          setScriptMeshPlacement({ meshes: newObjs as Array<import("three").Object3D>, objectId, sceneId, cachedCode: code });
        }
      } else {
        (worldAPI as { showToast: (t: string, d?: number) => void }).showToast(`脚本错误: ${err}`, 5000);
      }
    },
    [scene],
  );

  const handleSplatInteract = useCallback(
    async (objectId: string, action: string) => {
      if (!scene) return;
      // Route NPC interactions to the dedicated NPC chat overlay
      const obj = scene.sceneData.objects.find((o) => o.objectId === objectId);
      if (obj?.type === "npc") {
        if (document.pointerLockElement) document.exitPointerLock();
        setNpcChatTarget({ objectId, name: obj.name });
        setNpcChatHistory([]);
        setNpcChatPending(false);
        return;
      }
      // If prop has cachedCode, execute it locally — no server round-trip needed
      const skillMeta = (obj?.metadata?.skill ?? {}) as Record<string, unknown>;
      const skillCfg = (skillMeta.config ?? {}) as Record<string, unknown>;
      if ((skillMeta.name === "code-gen" || skillMeta.name === "static-script") && skillCfg.cachedCode) {
        runScriptAndCalibrate(String(skillCfg.cachedCode), objectId, scene.sceneId);
        return;
      }
      setNarrativeLines([]);
      setIsStreaming(true);
      streamingBuffer.current = "";
      try {
        const playerPosition = (window as unknown as Record<string, unknown>).__playerPosition as
          | { x: number; y: number; z: number }
          | undefined;
        const result = await postInteract({ sessionId, sceneId: scene.sceneId, objectId, action, playerPosition });
        if (result.display?.type === "script") {
          setIsStreaming(false);
          runScriptAndCalibrate(result.display.code, objectId, scene.sceneId);
        } else if (result.display?.type === "resource-picker") {
          setIsStreaming(false);
          const obj = scene.sceneData.objects.find((o) => o.objectId === objectId);
          const skillMeta = (obj?.metadata.skill ?? {}) as Record<string, unknown>;
          setResourcePicker({ needs: result.display.needs, title: result.display.title ?? "选择资源", objectId, action, skillMeta });
        } else if (result.display) {
          setIsStreaming(false);
          setBehaviorDisplay(result.display);
        }
      } catch (err) {
        setNarrativeLines([err instanceof Error ? err.message : "Interaction failed"]);
        setIsStreaming(false);
      }
    },
    [scene, sessionId],
  );

  // Re-fires interact with user-confirmed resources injected into interactionData
  const handleResourceConfirm = useCallback(
    async (choices: ResourceChoice[]) => {
      if (!resourcePicker || !scene) return;
      const { objectId, action, skillMeta } = resourcePicker;
      setResourcePicker(null);
      setIsStreaming(true);
      streamingBuffer.current = "";
      try {
        const playerPosition = (window as unknown as Record<string, unknown>).__playerPosition as
          | { x: number; y: number; z: number }
          | undefined;
        const result = await postInteract({
          sessionId,
          sceneId: scene.sceneId,
          objectId,
          action,
          playerPosition,
          interactionData: {
            ...(((skillMeta.config ?? {}) as Record<string, unknown>)),
            confirmedResources: choices,
          },
        });
        setIsStreaming(false);
        if (result.display?.type === "script") {
          const worldAPI = (window as unknown as Record<string, unknown>).__worldAPI;
          if (worldAPI) {
            const api = worldAPI as { scene: { children: Array<{ type?: string; renderOrder?: number; position: { set(x: number, y: number, z: number): void; x: number; y: number; z: number }; material?: { transparent?: boolean; needsUpdate?: boolean } | Array<{ transparent?: boolean; needsUpdate?: boolean }>; userData?: Record<string, unknown> }> } };
            const existingMeshes = api.scene.children.filter((c) => c.userData?.scriptObjectId === objectId && c.type === "Mesh");
            if (existingMeshes.length > 0) {
              setScriptMeshPlacement({ meshes: existingMeshes as Array<import("three").Object3D>, objectId, sceneId: scene.sceneId, cachedCode: result.display.code, frozen: true });
            } else {
              const countBefore = api.scene.children.length;
              const err = runScript(result.display.code, worldAPI as Parameters<typeof runScript>[1], buildScriptContext(scene, objectId));
              if (!err) {
                const newMeshes: Array<{ position: { set(x: number, y: number, z: number): void; x: number; y: number; z: number } }> = [];
                for (let i = countBefore; i < api.scene.children.length; i++) {
                  const child = api.scene.children[i];
                  if (child.type === "Mesh") {
                    if (child.renderOrder === 0) child.renderOrder = 1;
                    const mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
                    for (const m of mats) { if (!m.transparent) { m.transparent = true; m.needsUpdate = true; } }
                    newMeshes.push(child);
                  }
                  child.userData = { ...(child.userData ?? {}), scriptObjectId: objectId };
                }
                if (newMeshes.length > 0) {
                  setScriptMeshPlacement({ meshes: newMeshes as Array<import("three").Object3D>, objectId, sceneId: scene.sceneId, cachedCode: result.display.code });
                }
              } else {
                (worldAPI as { showToast: (t: string, d?: number) => void }).showToast(`脚本错误: ${err}`, 5000);
              }
            }
          }
        } else if (result.display) {
          setBehaviorDisplay(result.display);
        }
      } catch (err) {
        setNarrativeLines([err instanceof Error ? err.message : "Interaction failed"]);
        setIsStreaming(false);
      }
    },
    [resourcePicker, scene, sessionId],
  );

  // Skip resource picker — re-fires with skipResourcePicker=true so code-gen generates without resources
  const handleResourceSkip = useCallback(
    async () => {
      if (!resourcePicker || !scene) return;
      const { objectId, action, skillMeta } = resourcePicker;
      setResourcePicker(null);
      setIsStreaming(true);
      streamingBuffer.current = "";
      try {
        const playerPosition = (window as unknown as Record<string, unknown>).__playerPosition as
          | { x: number; y: number; z: number }
          | undefined;
        const result = await postInteract({
          sessionId,
          sceneId: scene.sceneId,
          objectId,
          action,
          playerPosition,
          interactionData: {
            ...((skillMeta.config ?? {}) as Record<string, unknown>),
            skipResourcePicker: true,
          },
        });
        setIsStreaming(false);
        if (result.display?.type === "script") {
          const worldAPI = (window as unknown as Record<string, unknown>).__worldAPI;
          if (worldAPI) {
            const api = worldAPI as { scene: { children: Array<{ type?: string; renderOrder?: number; position: { set(x: number, y: number, z: number): void; x: number; y: number; z: number }; material?: { transparent?: boolean; needsUpdate?: boolean } | Array<{ transparent?: boolean; needsUpdate?: boolean }>; userData?: Record<string, unknown> }> } };
            const countBefore = api.scene.children.length;
            const err = runScript(result.display.code, worldAPI as Parameters<typeof runScript>[1], buildScriptContext(scene, objectId));
            if (!err) {
              for (let i = countBefore; i < api.scene.children.length; i++) {
                const child = api.scene.children[i];
                child.userData = { ...(child.userData ?? {}), scriptObjectId: objectId };
              }
            } else {
              (worldAPI as { showToast: (t: string, d?: number) => void }).showToast(`脚本错误: ${err}`, 5000);
            }
          }
        } else if (result.display) {
          setBehaviorDisplay(result.display);
        }
      } catch (err) {
        setNarrativeLines([err instanceof Error ? err.message : "Interaction failed"]);
        setIsStreaming(false);
      }
    },
    [resourcePicker, scene, sessionId],
  );

  const runCodeGenPreset = useCallback(
    async (objectId: string, sceneId: string, interactionData: Record<string, unknown> = {}) => {
      if (!scene) return;
      const playerPosition = (window as unknown as Record<string, unknown>).__playerPosition as
        | { x: number; y: number; z: number }
        | undefined;
      try {
        const result = await postInteract({
          sessionId,
          sceneId,
          objectId,
          action: "interact",
          playerPosition,
          interactionData,
        });
        if (result.display?.type === "script") {
          const worldAPI = (window as unknown as Record<string, unknown>).__worldAPI;
          if (worldAPI) {
            const api = worldAPI as { scene: { children: Array<{ type?: string; renderOrder?: number; position: { set(x: number, y: number, z: number): void; x: number; y: number; z: number }; material?: { transparent?: boolean; needsUpdate?: boolean } | Array<{ transparent?: boolean; needsUpdate?: boolean }>; userData?: Record<string, unknown> }> } };
            const existingMeshes = api.scene.children.filter((c) => c.userData?.scriptObjectId === objectId && c.type === "Mesh");
            if (existingMeshes.length > 0) {
              setScriptMeshPlacement({ meshes: existingMeshes as Array<import("three").Object3D>, objectId, sceneId, cachedCode: result.display.code, frozen: true });
            } else {
              const countBefore = api.scene.children.length;
              const err = runScript(result.display.code, worldAPI as Parameters<typeof runScript>[1], buildScriptContext(scene, objectId));
              if (!err) {
                const newMeshes: Array<import("three").Object3D> = [];
                for (let i = countBefore; i < api.scene.children.length; i++) {
                  const child = api.scene.children[i];
                  if (child.type === "Mesh") {
                    if (child.renderOrder === 0) child.renderOrder = 1;
                    const mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
                    for (const m of mats) { if (!m.transparent) { m.transparent = true; m.needsUpdate = true; } }
                    newMeshes.push(child as unknown as import("three").Object3D);
                  }
                  child.userData = { ...(child.userData ?? {}), scriptObjectId: objectId };
                }
                if (newMeshes.length > 0) {
                  setScriptMeshPlacement({ meshes: newMeshes, objectId, sceneId, cachedCode: result.display.code });
                }
              } else {
                (worldAPI as { showToast: (t: string, d?: number) => void }).showToast(`脚本错误: ${err}`, 5000);
              }
            }
          }
        } else if (result.display?.type === "resource-picker") {
          setResourcePicker({
            needs: result.display.needs,
            title: result.display.title ?? "选择资源",
            objectId,
            action: "interact",
            skillMeta: {},
          });
        } else if (result.display) {
          setBehaviorDisplay(result.display);
        }
      } catch (err) {
        console.error("[code-gen] postInteract failed:", err);
      }
    },
    [scene, sessionId],
  );

  const handlePropApproach = useCallback(
    (objectId: string, name: string, skillName: string, skillConfig: Record<string, unknown>) => {
      // If cachedCode exists, auto-run it on approach (regardless of autoRun flag — code is ready)
      if ((skillName === "code-gen" || skillName === "static-script") && skillConfig.cachedCode) {
        const worldAPI = (window as unknown as Record<string, unknown>).__worldAPI;
        if (worldAPI) {
          const api = worldAPI as { scene: { children: Array<{ type?: string; renderOrder?: number; position: { set(x: number, y: number, z: number): void; x: number; y: number; z: number }; material?: { transparent?: boolean; needsUpdate?: boolean } | Array<{ transparent?: boolean; needsUpdate?: boolean }>; userData?: Record<string, unknown> }> } };
          // Don't re-run if objects from this prop are already in the scene
          const alreadyRan = api.scene.children.some((c) => c.userData?.scriptObjectId === objectId);
          if (alreadyRan) return;
          const countBefore = api.scene.children.length;
          const err = runScript(String(skillConfig.cachedCode), worldAPI as Parameters<typeof runScript>[1], sceneRef.current ? buildScriptContext(sceneRef.current, objectId) : undefined);
          if (!err) {
            for (let i = countBefore; i < api.scene.children.length; i++) {
              const child = api.scene.children[i];
              if (child.type === "Mesh") {
                if (child.renderOrder === 0) child.renderOrder = 1;
                const mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
                for (const m of mats) { if (!m.transparent) { m.transparent = true; m.needsUpdate = true; } }
              }
              child.userData = { ...(child.userData ?? {}), scriptObjectId: objectId };
            }
          }
          return;
        }
      }
      // preset code-gen with no cachedCode: E key fires handleSplatInteract to generate
      if (skillName === "code-gen" && skillConfig.mode !== "interactive") return;
      setActivePropPanel({ objectId, name, skillName, skillConfig });
    },
    [],
  );

  const handlePropLeave = useCallback(() => {
    setActivePropPanel(null);
  }, []);

  const handlePositionConfirm = useCallback(
    async (pos: { x: number; y: number; z: number }) => {
      if (!positionPicker) return;
      if (positionPicker.onConfirmLocal) {
        positionPicker.onConfirmLocal(pos);
      } else if (positionPicker.pickerId) {
        try {
          await fetch(`/confirm-position/${positionPicker.pickerId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pos }),
          });
        } catch (err) {
          console.error("confirm-position failed", err);
        }
      }
      setPositionPicker(null);
    },
    [positionPicker],
  );

  const handlePositionSkip = useCallback(async () => {
    if (!positionPicker) return;
    if (positionPicker.onSkipLocal) {
      positionPicker.onSkipLocal();
    } else if (positionPicker.onConfirmLocal) {
      // For local picker without explicit skip handler, skip = use estimated position
      positionPicker.onConfirmLocal(positionPicker.estimatedPos);
    } else if (positionPicker.pickerId) {
      try {
        await fetch(`/confirm-position/${positionPicker.pickerId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pos: positionPicker.estimatedPos }),
        });
      } catch (err) {
        console.error("confirm-position skip failed", err);
      }
    }
    setPositionPicker(null);
  }, [positionPicker]);

  const handlePropPanelSelect = useCallback(
    async (value: string) => {
      if (!activePropPanel || !scene) return;
      const { objectId, skillName, skillConfig, name } = activePropPanel;

      // tv-display skill: render HTML directly on TV screen, no LLM call needed
      if (skillName === "tv-display") {
        const playerPosition = (window as unknown as Record<string, unknown>).__playerPosition as
          | { x: number; y: number; z: number }
          | undefined;
        try {
          const result = await postInteract({
            sessionId,
            sceneId: scene.sceneId,
            objectId,
            action: "interact",
            playerPosition,
          });
          if (result.display?.type === "tv") {
            setBehaviorDisplay({ type: "html", content: result.display.content, title: result.display.title });
          } else if (result.display) {
            setBehaviorDisplay(result.display);
          }
        } catch (err) {
          console.error("[tv-display] postInteract failed:", err);
        }
        setActivePropPanel(null);
        return;
      }

      // code-gen skill: delegate to runCodeGenPreset
      if (skillName === "code-gen" || skillName === "static-script") {
        const interactionData: Record<string, unknown> =
          skillName === "code-gen" && value !== "__preset__" ? { userRequest: value } : {};
        await runCodeGenPreset(objectId, scene.sceneId, interactionData);
        setActivePropPanel(null);
        return;
      }

      // video-player skill: resolve display client-side
      const title = skillConfig.title as string | undefined;
      const display = resolveVideoDisplay(value, title ?? name);
      setBehaviorDisplay(display);
      setActivePropPanel(null);
    },
    [activePropPanel, scene, sessionId, runCodeGenPreset],
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
        chatHistory: npcChatHistory,
      }).catch((err) => {
        setNpcChatPending(false);
        setNpcChatHistory((prev) => [...prev, { role: "npc", text: `(出错了: ${err instanceof Error ? err.message : "未知错误"})` }]);
      });
    },
    [scene, sessionId, npcChatTarget],
  );

  const handleNpcApproach = useCallback(
    (objectId: string, _name: string) => {
      if (!scene) return;
      // Mutual exclusion: suppress NPC approach while any placement is in progress
      if (pendingProp !== null || pendingNpc !== null) return;
      const key = `${scene.sceneId}:${objectId}`;
      // Proximity only triggers a greeting speech bubble — no overlay, no pointer lock exit.
      // Trigger greeting only once per session.
      if (greetedNpcsRef.current.has(key)) return;
      greetedNpcsRef.current.add(key);
      const playerPosition = (window as unknown as Record<string, unknown>).__playerPosition as
        | { x: number; y: number; z: number }
        | undefined;
      postNpcGreet({ sessionId, sceneId: scene.sceneId, npcObjectId: objectId, playerPosition }).catch(
        (err: unknown) => { console.error("[npc-greet]", err); },
      );
    },
    [scene, sessionId, pendingProp, pendingNpc],
  );

  const handleNpcClick = useCallback(
    (objectId: string, name: string) => {
      if (!scene) return;
      if (pendingProp !== null || pendingNpc !== null) return;
      // Exit pointer lock so the chat input can receive focus.
      if (document.pointerLockElement) document.exitPointerLock();
      setNpcChatTarget({ objectId, name });
      setNpcChatHistory([]);
      setNpcChatPending(false);
    },
    [scene, pendingProp, pendingNpc],
  );

  const handlePlayerMove = useCallback(() => {
    if (npcChatTarget) {
      setNpcChatTarget(null);
      setNpcChatHistory([]);
      setNpcChatPending(false);
    }
  }, [npcChatTarget]);

  const handleNpcLeave = useCallback((objectId: string) => {
    if (!scene) return;
    const key = `${scene.sceneId}:${objectId}`;
    greetedNpcsRef.current.delete(key);
  }, [scene]);

  const handlePortalApproach = useCallback(
    (_objectId: string, targetSceneId: string | null, _targetSceneName: string | null) => {
      if (pendingProp !== null || pendingNpc !== null) return;
      if (targetSceneId) {
        // Travel immediately — no confirmation needed
        loadSceneById(targetSceneId, { session: sessionId });
      } else {
        // No preset target — open scene picker
        setPortalScenePicker(true);
      }
    },
    [pendingProp, pendingNpc, loadSceneById, sessionId],
  );

  const handlePortalLeave = useCallback(() => {
    setPortalScenePicker(false);
  }, []);

  const handlePortalTravel = useCallback(
    (targetSceneId: string) => {
      setPortalScenePicker(false);
      loadSceneById(targetSceneId, { session: sessionId });
    },
    [loadSceneById, sessionId],
  );

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
              sceneId={scene.sceneId}
              sessionId={sessionId}
              onInteract={handleSplatInteract}
              onNpcApproach={handleNpcApproach}
              onNpcLeave={handleNpcLeave}
              onNpcClick={handleNpcClick}
              onPlayerMove={handlePlayerMove}
              speechFeed={speechFeed}
              npcPlacementPending={pendingNpc !== null}
              onCameraReady={(api) => { cameraAPIRef.current = api; }}
              onNpcPlace={(pos) => {                if (!pendingNpc || !scene) return;
                const npcSnapshot = pendingNpc;
                setPendingNpc(null);
                if (npcSnapshot.objectId) {
                  // Re-placing an existing NPC — just update its position
                  patchSceneObjectPosition(scene.sceneId, sessionId, npcSnapshot.objectId, pos)
                    .then(() => loadSceneById(scene.sceneId, { session: sessionId }))
                    .catch(console.warn);
                } else {
                  // Creating a new NPC
                  const fwd = (window as unknown as Record<string, unknown>).__cameraForward as
                    | { x: number; z: number } | undefined;
                  addSceneNpc(scene.sceneId, sessionId, {
                    ...npcSnapshot,
                    placement: "exact",
                    playerPosition: pos,
                    cameraForward: fwd,
                  })
                    .then(() => loadSceneById(scene.sceneId, { session: sessionId }))
                    .catch(console.warn);
                }
              }}
              onNpcPlaceCancel={() => setPendingNpc(null)}
              propPlacementPending={pendingProp !== null}
              onPropPlace={(pos) => {
                if (!pendingProp || !scene) return;
                const propSnapshot = pendingProp;
                setPendingProp(null);
                if (propSnapshot.objectId) {
                  // Re-placing an existing prop — just update its position
                  patchSceneObjectPosition(scene.sceneId, sessionId, propSnapshot.objectId, pos)
                    .then(() => loadSceneById(scene.sceneId, { session: sessionId }))
                    .catch(console.warn);
                } else {
                  // Placing a newly generated prop
                  addSceneProp(scene.sceneId, sessionId, {
                    name: propSnapshot.name,
                    description: propSnapshot.description,
                    modelUrl: propSnapshot.modelUrl,
                    scale: propSnapshot.scale,
                    placement: "exact",
                    playerPosition: pos,
                  })
                    .then(() => loadSceneById(scene.sceneId, { session: sessionId }))
                    .catch(console.warn);
                }
              }}
              onPropPlaceCancel={() => setPendingProp(null)}
              portalPlacementPending={pendingPortal !== null}
              onPortalPlace={(pos) => {
                if (!pendingPortal || !scene) return;
                const portalSnapshot = pendingPortal;
                setPendingPortal(null);
                addScenePortal(scene.sceneId, sessionId, {
                  ...portalSnapshot,
                  playerPosition: pos,
                })
                  .then(() => loadSceneById(scene.sceneId, { session: sessionId }))
                  .catch(console.warn);
              }}
              onPortalPlaceCancel={() => setPendingPortal(null)}
              scriptMeshPlacementPending={scriptMeshPlacement !== null && !scriptMeshPlacement.frozen}
              scriptMeshes={scriptMeshPlacement?.meshes}
              onScriptMeshPlace={() => { /* confirm handled by button overlay */ }}
              onScriptMeshPlaceCancel={() => setScriptMeshPlacement((prev) => prev ? { ...prev, frozen: true } : null)}
              onPortalApproach={handlePortalApproach}
              onPortalLeave={handlePortalLeave}
              onPropApproach={handlePropApproach}
              onPropLeave={handlePropLeave}
              ghostModelUrl={pendingNpc?.modelUrl ?? pendingProp?.modelUrl ?? undefined}
              ghostModelScale={pendingNpc?.scale ?? pendingProp?.scale ?? 1}
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

      {/* Toolbar buttons — top-right, shown when a scene is loaded */}
      {scene && (
        <div style={{ position: "fixed", top: 16, right: 16, display: "flex", gap: 8, zIndex: 105 }}>
          <button
            onClick={() => setShowCamera((v) => !v)}
            style={{
              background: showCamera ? "rgba(160,80,255,0.35)" : "rgba(20,15,40,0.75)",
              border: "1px solid rgba(160,80,255,0.35)",
              borderRadius: 8, padding: "7px 14px",
              color: "rgba(230,200,255,0.9)", fontSize: 13,
              cursor: "pointer",
              backdropFilter: "blur(8px)",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            相机
          </button>
          <button
            onClick={() => {
              setShowPropDrawer((v) => {
                if (!v) { setShowNpcDrawer(false); }
                return !v;
              });
            }}
            style={{
              background: showPropDrawer ? "rgba(80,200,140,0.35)" : "rgba(20,15,40,0.75)",
              border: "1px solid rgba(80,200,140,0.35)",
              borderRadius: 8, padding: "7px 14px",
              color: "rgba(200,255,220,0.9)", fontSize: 13,
              cursor: "pointer",
              backdropFilter: "blur(8px)",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            物件
          </button>
          <button
            onClick={() => {
                setShowNpcDrawer((v) => {
                  if (!v) { setNpcChatTarget(null); setShowPropDrawer(false); setShowPortalDrawer(false); }
                  return !v;
                });
              }}
            style={{
              background: showNpcDrawer ? "rgba(120,80,255,0.4)" : "rgba(20,15,40,0.75)",
              border: "1px solid rgba(140,100,255,0.35)",
              borderRadius: 8, padding: "7px 14px",
              color: "rgba(200,220,255,0.9)", fontSize: 13,
              cursor: "pointer",
              backdropFilter: "blur(8px)",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            NPC
          </button>
          <button
            onClick={() => {
              setShowPortalDrawer((v) => {
                if (!v) { setShowNpcDrawer(false); setShowPropDrawer(false); }
                return !v;
              });
            }}
            style={{
              background: showPortalDrawer ? "rgba(100,60,220,0.4)" : "rgba(20,15,40,0.75)",
              border: "1px solid rgba(120,80,255,0.35)",
              borderRadius: 8, padding: "7px 14px",
              color: "rgba(210,200,255,0.9)", fontSize: 13,
              cursor: "pointer",
              backdropFilter: "blur(8px)",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            传送门
          </button>
        </div>
      )}

      {/* NPC management drawer */}
      <NpcDrawer
        open={showNpcDrawer}
        onClose={() => setShowNpcDrawer(false)}
        scene={scene}
        sessionId={sessionId}
        onNpcUpdated={() => { if (scene) loadSceneById(scene.sceneId, { session: sessionId }); }}
        onNpcDeleted={() => { if (scene) loadSceneById(scene.sceneId, { session: sessionId }); }}
        onBeginPlacement={(npc) => {
          setNpcChatTarget(null);
          setShowNpcDrawer(false);
          setPendingNpc(npc);
        }}
        generatedNpcModels={generatedNpcModels}
        onNpcModelGenerated={addGeneratedNpcModel}
      />

      {/* Prop generation drawer */}
      <PropDrawer
        open={showPropDrawer}
        onClose={() => setShowPropDrawer(false)}
        scene={scene}
        sessionId={sessionId}
        generatedProps={generatedProps}
        onPropGenerated={addGeneratedProp}
        onBeginPlacement={(prop) => {
          setPendingProp(prop);
          setNpcChatTarget(null);
          setShowPropDrawer(false);
        }}
      />

      {/* Portal drawer */}
      <PortalDrawer
        open={showPortalDrawer}
        onClose={() => setShowPortalDrawer(false)}
        currentSceneId={scene?.sceneId}
        onPlace={(portalDef) => {
          setPendingPortal(portalDef);
          setShowPortalDrawer(false);
        }}
      />

      {/* Portal scene picker — shown when player approaches portal without a preset target */}
      {portalScenePicker && (
        <PortalDrawer
          open={portalScenePicker}
          onClose={() => setPortalScenePicker(false)}
          currentSceneId={scene?.sceneId}
          onPlace={(portalDef) => {
            setPortalScenePicker(false);
            if (portalDef.targetSceneId) {
              handlePortalTravel(portalDef.targetSceneId);
            }
          }}
        />
      )}

      {/* Behavior skill overlay — shown when an interactive object with a skill is activated */}
      {behaviorDisplay && (
        <BehaviorOverlay display={behaviorDisplay} onClose={() => setBehaviorDisplay(null)} />
      )}

      {/* Resource picker — shown when code-gen needs texture/asset selection before generating */}
      {resourcePicker && (
        <ResourcePickerPanel
          title={resourcePicker.title}
          needs={resourcePicker.needs}
          sessionId={sessionId}
          onConfirm={handleResourceConfirm}
          onSkip={handleResourceSkip}
          onDismiss={() => setResourcePicker(null)}
        />
      )}

      {/* Proximity prop panel — shown when player approaches an interactive prop */}
      {activePropPanel && !behaviorDisplay && (
        <PropInteractionPanel
          objectName={activePropPanel.name}
          skillName={activePropPanel.skillName}
          skillConfig={activePropPanel.skillConfig}
          onSelect={handlePropPanelSelect}
          onDismiss={() => setActivePropPanel(null)}
        />
      )}

      {positionPicker && (
        <PositionPicker
          panoUrl={positionPicker.panoUrl}
          objectName={positionPicker.objectName}
          estimatedPos={positionPicker.estimatedPos}
          pickerId={positionPicker.pickerId}
          onConfirm={handlePositionConfirm}
          onSkip={handlePositionSkip}
        />
      )}

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

      {/* Script display panel from world.setDisplay(html) */}
      {scriptDisplay && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 400,
            minWidth: 280,
            maxWidth: 480,
            background: "rgba(8,6,20,0.94)",
            border: "1px solid rgba(120,80,255,0.35)",
            borderRadius: 12,
            boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            backdropFilter: "blur(10px)",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 10px 0" }}>
            <button
              type="button"
              onClick={() => setScriptDisplay(null)}
              style={{ background: "none", border: "none", color: "rgba(160,140,220,0.7)", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
            >×</button>
          </div>
          {/* eslint-disable-next-line react/no-danger */}
          <div
            style={{ padding: "4px 18px 18px", color: "rgba(210,195,255,0.92)", fontSize: 15, lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: scriptDisplay }}
          />
        </div>
      )}

      {/* Script mesh drag-to-place hint */}
      {scriptMeshPlacement && (
        <div style={{
          position: "fixed",
          bottom: 32,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.80)",
          color: "#fff",
          borderRadius: 10,
          padding: "12px 20px",
          fontSize: 13,
          zIndex: 9998,
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.18)",
          display: "flex",
          alignItems: "center",
          gap: 16,
          userSelect: "none",
        }}>
          <span style={{ opacity: 0.85 }}>
            {scriptMeshPlacement.frozen ? "位置已冻结，确认后自动适配屏幕大小" : "场景模式调整位置，按 ESC 冻结"}
          </span>
          <button
            disabled={!scriptMeshPlacement.frozen}
            style={{ background: scriptMeshPlacement.frozen ? "#4a7fff" : "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", cursor: scriptMeshPlacement.frozen ? "pointer" : "default", fontWeight: 600, fontSize: 13, opacity: scriptMeshPlacement.frozen ? 1 : 0.5 }}
            onClick={() => {
              if (!scriptMeshPlacement?.frozen) return;
              const snap = scriptMeshPlacement;
              const meshRaw = snap.meshes[0] as unknown as { position: { x: number; y: number; z: number }; scale: { set(x: number, y: number, z: number): void; x: number; y: number; z: number }; geometry?: { parameters?: { width?: number; height?: number } } };
              if (!meshRaw) return;
              const pos = { x: meshRaw.position.x, y: meshRaw.position.y, z: meshRaw.position.z };
              setScriptMeshPlacement(null);

              const propObj = scene?.sceneData.objects.find((o) => o.objectId === snap.objectId);
              const targetH = typeof propObj?.metadata?.targetHeight === "number" ? propObj.metadata.targetHeight : null;
              const targetW = typeof propObj?.metadata?.targetWidth === "number"
                ? propObj.metadata.targetWidth
                : targetH !== null ? Math.round(targetH * (16 / 9) * 100) / 100 : null;

              const DURATION = 600;
              const startTime = performance.now();
              const meshRefs = snap.meshes as Array<{ scale: { set(x: number, y: number, z: number): void; x: number; y: number; z: number }; geometry?: { parameters?: { width?: number; height?: number } } }>;
              // Start tiny so the grow-to-fit animation is always visible
              for (const m of meshRefs) m.scale.set(0.01, 0.01, 1);
              const targetScales = meshRefs.map((m) => {
                if (targetW === null || targetH === null) return { x: 1, y: 1 };
                const geoW = m.geometry?.parameters?.width ?? 1;
                const geoH = m.geometry?.parameters?.height ?? 1;
                return { x: targetW / geoW, y: targetH / geoH };
              });

              const animateTween = (now: number) => {
                const t = Math.min((now - startTime) / DURATION, 1);
                const ease = 1 - Math.pow(1 - t, 3);
                for (let i = 0; i < meshRefs.length; i++) {
                  const e = targetScales[i];
                  meshRefs[i].scale.set(0.01 + (e.x - 0.01) * ease, 0.01 + (e.y - 0.01) * ease, 1);
                }
                if (t < 1) { requestAnimationFrame(animateTween); return; }
                let patchedCode = snap.cachedCode
                  .replace(/mesh\.position\.set\([^)]*\)/g, `mesh.position.set(${pos.x.toFixed(4)}, ${pos.y.toFixed(4)}, ${pos.z.toFixed(4)})`);
                if (targetW !== null && targetH !== null) {
                  patchedCode = patchedCode.replace(/PlaneGeometry\([^)]*\)/g, `PlaneGeometry(${targetW}, ${targetH})`);
                }
                patchSceneObjectPosition(snap.sceneId, sessionId, snap.objectId, pos, { cachedCode: patchedCode }, pos.y).catch(console.warn);
              };
              requestAnimationFrame(animateTween);
            }}
          >确认位置</button>
          {scriptMeshPlacement.frozen && (
            <button
              style={{ background: "rgba(255,255,255,0.10)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 13 }}
              onClick={() => setScriptMeshPlacement((prev) => prev ? { ...prev, frozen: false } : null)}
            >重新调整</button>
          )}
          <button
            style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 13 }}
            onClick={() => {
              const wapi = (window as unknown as Record<string, unknown>).__worldAPI as { scene: { remove(o: object): void } } | undefined;
              if (wapi && scriptMeshPlacement) {
                for (const m of scriptMeshPlacement.meshes) wapi.scene.remove(m as object);
              }
              setScriptMeshPlacement(null);
            }}
          >取消</button>
        </div>
      )}

      {/* Script toast from WorldAPI */}
      {scriptToast && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 600,
            background: "rgba(8,6,20,0.90)",
            border: "1px solid rgba(120,80,255,0.4)",
            borderRadius: 8,
            color: "rgba(210,195,255,0.95)",
            fontSize: 13,
            padding: "8px 16px",
            pointerEvents: "none",
            backdropFilter: "blur(6px)",
          }}
        >
          {scriptToast}
        </div>
      )}

      {/* Camera panel */}
      {showCamera && (
        <CameraPanel
          cameraAPI={cameraAPIRef.current}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
}
