import { useState, useRef, useEffect, useCallback } from "react";

interface Props {
  videoBlob: Blob;
  onRetake: () => void;
  onClose: () => void;
}

export function VideoEditor({ videoBlob, onRetake, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trimIn, setTrimIn] = useState(0);
  const [trimOut, setTrimOut] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const videoUrl = useRef<string>("");

  useEffect(() => {
    videoUrl.current = URL.createObjectURL(videoBlob);
    return () => { URL.revokeObjectURL(videoUrl.current); };
  }, [videoBlob]);

  const onMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    setTrimIn(0);
    setTrimOut(v.duration);
  }, []);

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    // Loop within trim range
    if (v.currentTime >= trimOut) {
      v.currentTime = trimIn;
      if (!playing) v.pause();
    }
  }, [trimIn, trimOut, playing]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime >= trimOut || v.currentTime < trimIn) v.currentTime = trimIn;
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }, [trimIn, trimOut]);

  // Seek by clicking timeline
  const onTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || duration === 0) return;
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    const clamped = Math.max(trimIn, Math.min(trimOut, t));
    if (videoRef.current) videoRef.current.currentTime = clamped;
  }, [duration, trimIn, trimOut]);

  // Drag helpers for trim handles
  const startDrag = useCallback((handle: "in" | "out") => (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || duration === 0) return;

    const onMove = (ev: MouseEvent) => {
      const t = Math.max(0, Math.min(duration, ((ev.clientX - rect.left) / rect.width) * duration));
      if (handle === "in") {
        setTrimIn(Math.min(t, trimOut - 0.1));
        if (videoRef.current) videoRef.current.currentTime = Math.min(t, trimOut - 0.1);
      } else {
        setTrimOut(Math.max(t, trimIn + 0.1));
        if (videoRef.current) videoRef.current.currentTime = Math.max(t, trimIn + 0.1);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [duration, trimIn, trimOut]);

  // Export: re-encode selected range via canvas + MediaRecorder
  const handleExport = useCallback(async () => {
    const v = videoRef.current;
    if (!v || exporting) return;
    const trimDuration = trimOut - trimIn;

    // If no real trim, just download the original blob directly
    if (trimIn < 0.05 && trimOut > duration - 0.05) {
      const a = document.createElement("a");
      a.href = videoUrl.current;
      a.download = `video_${Date.now()}.webm`;
      a.click();
      return;
    }

    setExporting(true);
    setExportProgress(0);

    try {
      // Draw each frame to an offscreen canvas then pipe through MediaRecorder
      const offscreen = document.createElement("canvas");
      offscreen.width = v.videoWidth || 1280;
      offscreen.height = v.videoHeight || 720;
      const ctx = offscreen.getContext("2d")!;
      // ctx used below in onseeked to draw each frame

      const fps = 30;
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const stream = (offscreen as unknown as { captureStream(fps: number): MediaStream }).captureStream(fps);
      const mr = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      await new Promise<void>((resolve, reject) => {
        mr.onstop = () => resolve();
        mr.onerror = () => reject(new Error("MediaRecorder error"));
        mr.start(100);

        let frameTime = trimIn;
        const frameInterval = 1 / fps;
        let done = false;

        const nextFrame = () => {
          if (done) return;
          if (frameTime > trimOut) {
            done = true;
            mr.stop();
            resolve();
            return;
          }
          v.currentTime = frameTime;
          setExportProgress(Math.round(((frameTime - trimIn) / trimDuration) * 100));
          frameTime += frameInterval;
        };

        v.onseeked = () => {
          ctx.drawImage(v, 0, 0, offscreen.width, offscreen.height);
          nextFrame();
        };
        v.currentTime = trimIn;
      });

      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `video_${Date.now()}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error("[VideoEditor] export failed:", err);
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }, [exporting, trimIn, trimOut, duration]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1).padStart(4, "0");
    return `${m}:${sec}`;
  };

  const pct = (t: number) => duration > 0 ? `${(t / duration) * 100}%` : "0%";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 501,
      background: "rgba(4,3,12,0.97)",
      display: "flex", flexDirection: "column",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: "1px solid rgba(120,80,255,0.25)", flexShrink: 0,
      }}>
        <button type="button" onClick={onRetake} style={edBtnStyle}>← 重录</button>
        <span style={{ color: "rgba(210,195,255,0.9)", fontSize: 15, fontWeight: 500 }}>视频编辑</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={handleExport} disabled={exporting}
            style={{ ...edBtnStyle, background: "rgba(120,80,255,0.3)", border: "1px solid rgba(160,100,255,0.5)", opacity: exporting ? 0.6 : 1 }}>
            {exporting ? `导出中 ${exportProgress}%` : "导出"}
          </button>
          <button type="button" onClick={onClose} style={edBtnStyle}>×</button>
        </div>
      </div>

      {/* Video player */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: "12px 0" }}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          src={videoUrl.current}
          onLoadedMetadata={onMetadata}
          onTimeUpdate={onTimeUpdate}
          onEnded={() => setPlaying(false)}
          style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 6, display: "block" }}
        />
      </div>

      {/* Controls */}
      <div style={{
        borderTop: "1px solid rgba(120,80,255,0.25)",
        background: "rgba(8,6,20,0.9)",
        padding: "14px 16px 20px",
        display: "flex", flexDirection: "column", gap: 12,
        flexShrink: 0,
      }}>
        {/* Play / time */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button type="button" onClick={togglePlay} style={{ ...edBtnStyle, padding: "6px 16px", minWidth: 60 }}>
            {playing ? "暂停" : "播放"}
          </button>
          <span style={{ color: "rgba(180,165,240,0.8)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
            {fmt(currentTime)} / {fmt(duration)}
          </span>
          <span style={{ color: "rgba(140,125,200,0.6)", fontSize: 12, marginLeft: "auto" }}>
            剪辑: {fmt(trimIn)} — {fmt(trimOut)}  ({fmt(trimOut - trimIn)})
          </span>
        </div>

        {/* Timeline */}
        <div style={{ position: "relative", height: 40, userSelect: "none" }}>
          {/* Track bg */}
          <div
            ref={timelineRef}
            onClick={onTimelineClick}
            style={{
              position: "absolute", top: "50%", transform: "translateY(-50%)",
              left: 0, right: 0, height: 6,
              background: "rgba(255,255,255,0.1)", borderRadius: 3, cursor: "pointer",
            }}
          />
          {/* Selected range highlight */}
          <div style={{
            position: "absolute", top: "50%", transform: "translateY(-50%)",
            left: pct(trimIn), width: `calc(${pct(trimOut)} - ${pct(trimIn)})`,
            height: 6, background: "rgba(120,80,255,0.7)", borderRadius: 3, pointerEvents: "none",
          }} />
          {/* Playhead */}
          {duration > 0 && (
            <div style={{
              position: "absolute", top: "50%", transform: "translate(-50%, -50%)",
              left: pct(currentTime),
              width: 3, height: 24, background: "rgba(255,255,255,0.9)", borderRadius: 2,
              pointerEvents: "none",
            }} />
          )}
          {/* Trim-in handle */}
          {duration > 0 && (
            <div
              onMouseDown={startDrag("in")}
              style={{
                position: "absolute", top: "50%", transform: "translate(-50%, -50%)",
                left: pct(trimIn),
                width: 14, height: 28,
                background: "#44cc88", borderRadius: 4, cursor: "ew-resize",
                border: "2px solid rgba(255,255,255,0.6)",
              }}
              title="拖动设置入点"
            />
          )}
          {/* Trim-out handle */}
          {duration > 0 && (
            <div
              onMouseDown={startDrag("out")}
              style={{
                position: "absolute", top: "50%", transform: "translate(-50%, -50%)",
                left: pct(trimOut),
                width: 14, height: 28,
                background: "#ee4444", borderRadius: 4, cursor: "ew-resize",
                border: "2px solid rgba(255,255,255,0.6)",
              }}
              title="拖动设置出点"
            />
          )}
        </div>
        <div style={{ color: "rgba(140,125,200,0.6)", fontSize: 11, textAlign: "center" }}>
          拖动绿色/红色滑块设置剪辑入出点 · 点击时间轴定位
        </div>
      </div>
    </div>
  );
}

const edBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 8, color: "rgba(210,195,255,0.9)", fontSize: 14,
  cursor: "pointer", padding: "6px 14px", fontFamily: "system-ui",
};
