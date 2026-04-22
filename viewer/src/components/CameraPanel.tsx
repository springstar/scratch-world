import { useState, useCallback, useEffect, useRef } from "react";
import type { CameraAPI } from "./SplatViewer.js";
import { PhotoEditor } from "./PhotoEditor.js";
import { VideoEditor } from "./VideoEditor.js";

interface Props {
  cameraAPI: CameraAPI | null;
  onClose: () => void;
}

export function CameraPanel({ cameraAPI, onClose }: Props) {
  const [fov, setFovState] = useState(65);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevFovRef = useRef(65);

  const handleFovChange = useCallback((v: number) => {
    setFovState(v);
    cameraAPI?.setFov(v);
  }, [cameraAPI]);

  const handleCapture = useCallback(() => {
    if (!cameraAPI || isRecording) return;
    const dataUrl = cameraAPI.captureFrame();
    setCapturedImage(dataUrl);
  }, [cameraAPI, isRecording]);

  const handleRecordToggle = useCallback(async () => {
    if (!cameraAPI) return;
    if (!isRecording) {
      setIsRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
      cameraAPI.startRecording(30);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setIsRecording(false);
      const blob = await cameraAPI.stopRecording();
      if (blob) setRecordedBlob(blob);
    }
  }, [cameraAPI, isRecording]);

  const handleClose = useCallback(() => {
    if (isRecording) {
      if (timerRef.current) clearInterval(timerRef.current);
      void cameraAPI?.stopRecording();
    }
    cameraAPI?.setFov(prevFovRef.current);
    onClose();
  }, [isRecording, cameraAPI, onClose]);

  useEffect(() => {
    prevFovRef.current = 65;
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // C key closes when not recording and no overlay open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "c" || e.key === "C") && !capturedImage && !recordedBlob && !isRecording) handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose, capturedImage, recordedBlob, isRecording]);

  if (capturedImage) {
    return (
      <PhotoEditor
        imageDataUrl={capturedImage}
        onRetake={() => setCapturedImage(null)}
        onClose={() => { setCapturedImage(null); cameraAPI?.setFov(prevFovRef.current); onClose(); }}
      />
    );
  }

  if (recordedBlob) {
    return (
      <VideoEditor
        videoBlob={recordedBlob}
        onRetake={() => setRecordedBlob(null)}
        onClose={() => { setRecordedBlob(null); cameraAPI?.setFov(prevFovRef.current); onClose(); }}
      />
    );
  }

  const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, display: "flex", flexDirection: "column", pointerEvents: "none" }}>
      {/* Top bar */}
      <div style={{
        pointerEvents: "auto",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px",
        background: "rgba(8,6,20,0.75)", backdropFilter: "blur(8px)",
        borderBottom: "1px solid rgba(120,80,255,0.2)",
      }}>
        <button type="button" onClick={handleClose} style={btnStyle}>×</button>
        <span style={{ color: "rgba(210,195,255,0.9)", fontFamily: "system-ui", fontSize: 15, fontWeight: 500 }}>
          {isRecording ? (
            <span style={{ color: "#ff4444" }}>● {fmtTime(recordSeconds)}</span>
          ) : "相机"}
        </span>
        <div style={{ width: 42 }} />
      </div>

      <div style={{ flex: 1 }} />

      {/* Bottom controls */}
      <div style={{
        pointerEvents: "auto", padding: "16px",
        background: "rgba(8,6,20,0.82)", backdropFilter: "blur(10px)",
        borderTop: "1px solid rgba(120,80,255,0.2)",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        {/* FOV slider */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={labelStyle}>焦距</label>
          <input type="range" min={20} max={100} value={fov}
            onChange={(e) => handleFovChange(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#a07aff" }} />
          <span style={{ ...labelStyle, width: 28, textAlign: "right" }}>{fov}</span>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", justifyContent: "center", gap: 24, alignItems: "center" }}>
          {/* Photo capture */}
          <button type="button" onClick={handleCapture} disabled={isRecording}
            title="拍照"
            style={{
              background: isRecording ? "rgba(80,60,120,0.2)" : "rgba(160,100,255,0.25)",
              border: `2px solid ${isRecording ? "rgba(120,80,200,0.3)" : "rgba(160,100,255,0.7)"}`,
              borderRadius: "50%", width: 56, height: 56,
              cursor: isRecording ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, color: isRecording ? "rgba(180,160,240,0.4)" : "rgba(230,215,255,0.95)",
              opacity: isRecording ? 0.5 : 1,
            }}>
            O
          </button>

          {/* Record button */}
          <button type="button" onClick={handleRecordToggle}
            title={isRecording ? "停止录制" : "开始录制"}
            style={{
              background: isRecording ? "rgba(200,0,0,0.35)" : "rgba(255,80,80,0.2)",
              border: `2px solid ${isRecording ? "rgba(255,60,60,0.9)" : "rgba(255,80,80,0.6)"}`,
              borderRadius: "50%", width: 64, height: 64,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative",
            }}>
            {isRecording ? (
              <div style={{ width: 18, height: 18, background: "#ff4444", borderRadius: 3 }} />
            ) : (
              <div style={{ width: 22, height: 22, background: "#ff6666", borderRadius: "50%" }} />
            )}
          </button>
        </div>
        <div style={{ ...labelStyle, textAlign: "center", opacity: 0.6, fontSize: 11 }}>
          {isRecording ? "点击红色方块停止录制" : "圆圈=拍照  红圈=录视频"}
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 8, color: "rgba(210,195,255,0.9)", fontSize: 20,
  cursor: "pointer", padding: "4px 10px", lineHeight: 1, fontFamily: "system-ui",
};

const labelStyle: React.CSSProperties = {
  color: "rgba(190,175,240,0.8)", fontSize: 13, fontFamily: "system-ui", whiteSpace: "nowrap",
};
