import { useEffect, useRef, useState, useCallback } from "react";
import type { SceneData, Viewpoint } from "../types.js";
import { SceneRenderer } from "../renderer/scene-renderer.js";

interface Props {
  sceneData: SceneData;
  onObjectClick: (objectId: string, name: string, interactable: boolean) => void;
}

export function ViewerCanvas({ sceneData, onObjectClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // Init renderer once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    rendererRef.current = new SceneRenderer(canvas);
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Reload scene when data changes
  useEffect(() => {
    rendererRef.current?.loadScene(sceneData);
  }, [sceneData]);

  // Navigate to viewpoint from URL hash on load
  useEffect(() => {
    const hash = location.hash.replace("#", "");
    if (!hash) return;
    const vp = sceneData.viewpoints.find((v: Viewpoint) => v.viewpointId === hash);
    if (vp) rendererRef.current?.goToViewpoint(vp);
  }, [sceneData]);

  const toNdc = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
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
    [hovered, toNdc],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const r = rendererRef.current;
      if (!r) return;
      const { x, y } = toNdc(e);
      const hit = r.pick(x, y);
      if (hit) onObjectClick(hit.objectId, hit.name, hit.interactable);
    },
    [onObjectClick, toNdc],
  );

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block", cursor: hovered ? "pointer" : "default" }}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
    />
  );
}
