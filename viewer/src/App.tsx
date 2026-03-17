import { useState, useEffect, useCallback, useRef } from "react";
import { ViewerCanvas } from "./components/ViewerCanvas.js";
import { NarrativeOverlay } from "./components/NarrativeOverlay.js";
import { ViewpointBar } from "./components/ViewpointBar.js";
import { InteractionPrompt } from "./components/InteractionPrompt.js";
import { fetchScene, postInteract, connectRealtime } from "./api.js";
import type { SceneResponse, Viewpoint, RealtimeEvent } from "./types.js";

// Parse sceneId and sessionId from URL: /scene/<sceneId>?session=<sessionId>
function parseUrl(): { sceneId: string | null; sessionId: string | null } {
  const match = location.pathname.match(/\/scene\/([^/?#]+)/);
  const sessionId = new URLSearchParams(location.search).get("session");
  return { sceneId: match?.[1] ?? null, sessionId };
}

interface SelectedObject {
  objectId: string;
  name: string;
  interactable: boolean;
}

export function App() {
  const { sceneId, sessionId } = parseUrl();

  const [scene, setScene] = useState<SceneResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [narrativeLines, setNarrativeLines] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selected, setSelected] = useState<SelectedObject | null>(null);
  const streamingBuffer = useRef("");

  // Load scene on mount
  useEffect(() => {
    if (!sceneId) {
      setError("No scene ID in URL. Expected /scene/<sceneId>?session=<sessionId>");
      return;
    }
    fetchScene(sceneId)
      .then(setScene)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load scene"));
  }, [sceneId]);

  // Connect to realtime bus when sessionId is available
  useEffect(() => {
    if (!sessionId) return;
    const disconnect = connectRealtime(sessionId, (event: RealtimeEvent) => {
      if (event.type === "text_delta") {
        streamingBuffer.current += event.delta;
        setIsStreaming(true);
        setNarrativeLines([streamingBuffer.current]);
      } else if (event.type === "text_done") {
        setIsStreaming(false);
        setNarrativeLines([event.text]);
        streamingBuffer.current = "";
        // Auto-clear narrative after 8 seconds
        setTimeout(() => setNarrativeLines([]), 8000);
      } else if (event.type === "scene_updated" && scene && event.sceneId === scene.sceneId) {
        // Reload scene data after a mutation
        fetchScene(event.sceneId).then(setScene).catch(console.error);
      } else if (event.type === "error") {
        setNarrativeLines([`Error: ${event.message}`]);
        setIsStreaming(false);
      }
    });
    return disconnect;
  }, [sessionId, scene]);

  const handleObjectClick = useCallback(
    (objectId: string, name: string, interactable: boolean) => {
      setSelected({ objectId, name, interactable });
    },
    [],
  );

  const handleAction = useCallback(
    async (action: string) => {
      if (!selected || !sceneId || !sessionId) return;
      setSelected(null);
      setNarrativeLines([]);
      setIsStreaming(true);
      streamingBuffer.current = "";
      try {
        await postInteract({ sessionId, sceneId, objectId: selected.objectId, action });
      } catch (err) {
        setNarrativeLines([err instanceof Error ? err.message : "Interaction failed"]);
        setIsStreaming(false);
      }
    },
    [selected, sceneId, sessionId],
  );

  const handleViewpointSelect = useCallback((vp: Viewpoint) => {
    // ViewerCanvas handles navigation via goToViewpoint internally via the renderer ref,
    // but we need to trigger it from here. We update URL hash so ViewerCanvas effect fires.
    location.hash = vp.viewpointId;
  }, []);

  if (error) {
    return (
      <div style={{ color: "#f88", fontFamily: "monospace", padding: 24, background: "#111", height: "100%" }}>
        {error}
      </div>
    );
  }

  if (!scene) {
    return (
      <div style={{ color: "#f0e6cc", fontFamily: "Georgia, serif", padding: 24, background: "#111", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading world...
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <ViewerCanvas sceneData={scene.sceneData} onObjectClick={handleObjectClick} />
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
    </div>
  );
}
