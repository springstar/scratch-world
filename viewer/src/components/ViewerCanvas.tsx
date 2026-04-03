import { useEffect, useRef, useState, useCallback } from "react";
import type { SceneData, Viewpoint } from "../types.js";
import { SceneRenderer } from "../renderer/scene-renderer.js";

interface Props {
  sceneData: SceneData;
  onObjectClick: (objectId: string, name: string, interactable: boolean) => void;
  activeViewpoint?: Viewpoint | null;
  sceneId?: string;
  onScreenshot?: (sceneId: string, dataUrl: string) => void;
}

export function ViewerCanvas({ sceneData, onObjectClick, activeViewpoint, sceneId, onScreenshot }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [fading, setFading] = useState(false);
  const [fpLocked, setFpLocked] = useState(false);
  // Drag detection: skip click if mouse moved more than threshold pixels
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const DRAG_THRESHOLD = 5;

  // Init renderer once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = new SceneRenderer(canvas);
    rendererRef.current = r;
    r.init().catch(console.error);
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Track pointer lock state via browser event
  useEffect(() => {
    const onLockChange = () => {
      setFpLocked(!!document.pointerLockElement);
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => document.removeEventListener("pointerlockchange", onLockChange);
  }, []);

  // Reload scene when data changes — fade out → load → fade in
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    setFading(true);
    const t = setTimeout(() => {
      r.loadScene(sceneData)
        .then(() => {
          // Push screenshot 1.5s after load to allow async GLTF models to appear
          if (sceneId && onScreenshot) {
            const canvas = canvasRef.current;
            if (canvas) {
              setTimeout(() => {
                try {
                  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
                  onScreenshot(sceneId, dataUrl);
                } catch {
                  // Cross-origin or WebGPU canvas restrictions — skip silently
                }
              }, 1500);
            }
          }
        })
        .catch(console.error)
        .finally(() => setFading(false));
    }, 80);
    return () => clearTimeout(t);
  }, [sceneData, sceneId, onScreenshot]);

  // Navigate to viewpoint when it changes
  useEffect(() => {
    if (activeViewpoint) rendererRef.current?.goToViewpoint(activeViewpoint);
  }, [activeViewpoint]);

  const toNdc = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (fpLocked) return; // pointer locked — no raycasting
      const r = rendererRef.current;
      if (!r) return;
      const { x, y } = toNdc(e);
      const hit = r.pick(x, y);
      const id = hit?.interactable ? hit.objectId : null;
      if (id !== hovered) {
        setHovered(id);
        r.highlightObject(id);
      }
    },
    [hovered, toNdc, fpLocked],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (fpLocked) return; // clicks swallowed by browser in pointer lock, but guard anyway
      // Skip clicks that resulted from a drag (OrbitControls rotation)
      const down = mouseDownPos.current;
      if (down) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) return;
      }

      const r = rendererRef.current;
      if (!r) return;
      const { x, y } = toNdc(e);
      const hit = r.pick(x, y);
      if (hit) {
        onObjectClick(hit.objectId, hit.name, hit.interactable);
      }
    },
    [onObjectClick, toNdc, fpLocked],
  );

  const handleEnterWalkMode = useCallback(() => {
    rendererRef.current?.enterPointerLock();
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", cursor: fpLocked ? "none" : hovered ? "pointer" : "default" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
      />

      {/* Walk mode button — bottom-right corner */}
      {!fpLocked && (
        <button
          onClick={handleEnterWalkMode}
          title="Enter walk mode (WASD + mouse look)"
          style={{
            position: "absolute",
            bottom: 12,
            right: 12,
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 13,
            cursor: "pointer",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            letterSpacing: 0.3,
          }}
        >
          <span style={{ fontSize: 16 }}>&#x1F9CD;</span> Walk
        </button>
      )}

      {/* Crosshair + ESC hint while pointer is locked */}
      {fpLocked && (
        <>
          {/* Crosshair */}
          <div style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
            width: 20,
            height: 20,
          }}>
            <div style={{ position: "absolute", top: 9, left: 0, width: 20, height: 2, background: "rgba(255,255,255,0.8)" }} />
            <div style={{ position: "absolute", top: 0, left: 9, width: 2, height: 20, background: "rgba(255,255,255,0.8)" }} />
          </div>
          {/* ESC hint */}
          <div style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.45)",
            color: "rgba(255,255,255,0.7)",
            fontSize: 12,
            padding: "4px 12px",
            borderRadius: 6,
            pointerEvents: "none",
            backdropFilter: "blur(4px)",
            letterSpacing: 0.3,
          }}>
            WASD to move &middot; Mouse to look &middot; Shift to sprint &middot; ESC to exit
          </div>
        </>
      )}

      {/* Scene transition overlay — fades in when a new scene loads, then fades out */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#000",
          pointerEvents: "none",
          opacity: fading ? 1 : 0,
          transition: fading ? "none" : "opacity 0.4s ease-out",
        }}
      />
    </div>
  );
}
