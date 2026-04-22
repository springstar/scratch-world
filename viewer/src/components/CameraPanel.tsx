import { useState, useCallback, useEffect, useRef } from "react";
import type { CameraAPI } from "./SplatViewer.js";
import { PhotoEditor } from "./PhotoEditor.js";

interface Props {
  cameraAPI: CameraAPI | null;
  onClose: () => void;
}

export function CameraPanel({ cameraAPI, onClose }: Props) {
  const [selfie, setSelfie] = useState(false);
  const [fov, setFovState] = useState(65);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const prevFovRef = useRef(65);

  const handleSelfieToggle = useCallback(() => {
    const next = !selfie;
    setSelfie(next);
    cameraAPI?.setSelfieMode(next);
  }, [selfie, cameraAPI]);

  const handleFovChange = useCallback((v: number) => {
    setFovState(v);
    cameraAPI?.setFov(v);
  }, [cameraAPI]);

  const handleCapture = useCallback(() => {
    if (!cameraAPI) return;
    const dataUrl = cameraAPI.captureFrame();
    setCapturedImage(dataUrl);
  }, [cameraAPI]);

  const handleClose = useCallback(() => {
    // Restore camera state
    if (selfie) cameraAPI?.setSelfieMode(false);
    cameraAPI?.setFov(prevFovRef.current);
    onClose();
  }, [selfie, cameraAPI, onClose]);

  // Store FOV before opening so we can restore on close
  useEffect(() => {
    prevFovRef.current = 65;
  }, []);

  // C key toggles close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "c" || e.key === "C") && !capturedImage) handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose, capturedImage]);

  if (capturedImage) {
    return (
      <PhotoEditor
        imageDataUrl={capturedImage}
        onRetake={() => setCapturedImage(null)}
        onClose={() => {
          setCapturedImage(null);
          if (selfie) cameraAPI?.setSelfieMode(false);
          cameraAPI?.setFov(prevFovRef.current);
          onClose();
        }}
      />
    );
  }

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 500,
      display: "flex",
      flexDirection: "column",
      pointerEvents: "none",
    }}>
      {/* Top bar */}
      <div style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        background: "rgba(8,6,20,0.75)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid rgba(120,80,255,0.2)",
      }}>
        <button
          type="button"
          onClick={handleClose}
          style={btnStyle}
        >
          ×
        </button>
        <span style={{ color: "rgba(210,195,255,0.9)", fontFamily: "system-ui", fontSize: 15, fontWeight: 500 }}>
          相机
        </span>
        <button
          type="button"
          onClick={handleSelfieToggle}
          style={{
            ...btnStyle,
            background: selfie ? "rgba(120,80,255,0.4)" : "rgba(255,255,255,0.08)",
            border: selfie ? "1px solid rgba(160,120,255,0.6)" : "1px solid rgba(255,255,255,0.15)",
            padding: "5px 12px",
            fontSize: 13,
          }}
        >
          自拍
        </button>
      </div>

      {/* Spacer — scene renders through */}
      <div style={{ flex: 1 }} />

      {/* Bottom controls */}
      <div style={{
        pointerEvents: "auto",
        padding: "16px",
        background: "rgba(8,6,20,0.82)",
        backdropFilter: "blur(10px)",
        borderTop: "1px solid rgba(120,80,255,0.2)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}>
        {/* FOV slider */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={labelStyle}>焦距</label>
          <input
            type="range"
            min={20}
            max={100}
            value={fov}
            onChange={(e) => handleFovChange(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#a07aff" }}
          />
          <span style={{ ...labelStyle, width: 28, textAlign: "right" }}>{fov}</span>
        </div>

        {/* Capture button */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            onClick={handleCapture}
            style={{
              background: "rgba(160,100,255,0.25)",
              border: "2px solid rgba(160,100,255,0.7)",
              borderRadius: "50%",
              width: 64,
              height: 64,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
              color: "rgba(230,215,255,0.95)",
              transition: "all 0.15s",
            }}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.92)";
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "";
            }}
          >
            O
          </button>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 8,
  color: "rgba(210,195,255,0.9)",
  fontSize: 20,
  cursor: "pointer",
  padding: "4px 10px",
  lineHeight: 1,
  fontFamily: "system-ui",
};

const labelStyle: React.CSSProperties = {
  color: "rgba(190,175,240,0.8)",
  fontSize: 13,
  fontFamily: "system-ui",
  whiteSpace: "nowrap",
};
