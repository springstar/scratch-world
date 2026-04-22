import { useState, useRef, useEffect, useCallback } from "react";

type Filter = "none" | "vivid" | "warm" | "cool" | "bw" | "fade";
type ActiveTool = "none" | "crop" | "text" | "sticker";

interface TextItem {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
}

interface StickerItem {
  id: string;
  emoji: string;
  x: number;
  y: number;
  size: number;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  imageDataUrl: string;
  onRetake: () => void;
  onClose: () => void;
}

const FILTERS: { id: Filter; label: string; css: string }[] = [
  { id: "none",  label: "无",   css: "" },
  { id: "vivid", label: "鲜艳", css: "saturate(1.8) contrast(1.1)" },
  { id: "warm",  label: "暖色", css: "sepia(0.35) saturate(1.3)" },
  { id: "cool",  label: "冷色", css: "hue-rotate(20deg) saturate(1.2)" },
  { id: "bw",    label: "黑白", css: "grayscale(1)" },
  { id: "fade",  label: "褪色", css: "opacity(0.82) contrast(0.85) brightness(1.1)" },
];

const STICKERS = ["⭐", "❤️", "🔥", "✨", "😊", "🎉", "🌸", "🌈"];

function filterToCssString(
  filter: Filter,
  brightness: number,
  contrast: number,
  saturation: number,
): string {
  const base = FILTERS.find((f) => f.id === filter)?.css ?? "";
  const adj = `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100}) saturate(${1 + saturation / 100})`;
  return [base, adj].filter(Boolean).join(" ");
}

export function PhotoEditor({ imageDataUrl, onRetake, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [filter, setFilter] = useState<Filter>("none");
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [texts, setTexts] = useState<TextItem[]>([]);
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [activeTool, setActiveTool] = useState<ActiveTool>("none");
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropDraft, setCropDraft] = useState<CropRect | null>(null);
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);

  const [textInput, setTextInput] = useState("");
  const [textColor, setTextColor] = useState("#ffffff");
  const [textSize, setTextSize] = useState(28);
  const [dragItem, setDragItem] = useState<{ type: "text" | "sticker"; id: string; ox: number; oy: number } | null>(null);

  const CANVAS_W = 720;
  const CANVAS_H = 540;

  // Load source image once
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      drawCanvas();
    };
    img.src = imageDataUrl;
  }, [imageDataUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const filterStr = filterToCssString(filter, brightness, contrast, saturation);
    ctx.filter = filterStr || "none";

    if (cropRect) {
      // Draw cropped region
      ctx.drawImage(
        img,
        cropRect.x, cropRect.y, cropRect.w, cropRect.h,
        0, 0, CANVAS_W, CANVAS_H,
      );
    } else {
      ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
    }
    ctx.filter = "none";

    // Draw texts
    for (const t of texts) {
      ctx.font = `bold ${t.size}px system-ui, sans-serif`;
      ctx.fillStyle = t.color;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 3;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillText(t.text, t.x, t.y);
    }

    // Draw stickers
    for (const s of stickers) {
      ctx.font = `${s.size}px serif`;
      ctx.fillText(s.emoji, s.x, s.y);
    }

    // Draw crop selection draft
    if (cropDraft) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(cropDraft.x, cropDraft.y, cropDraft.w, cropDraft.h);
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      ctx.fillRect(cropDraft.x, cropDraft.y, cropDraft.w, cropDraft.h);
      ctx.restore();
    }
  }, [filter, brightness, contrast, saturation, texts, stickers, cropRect, cropDraft]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
      y: (e.clientY - rect.top) * (CANVAS_H / rect.height),
    };
  };

  const onCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e);

    if (activeTool === "crop") {
      cropStartRef.current = pos;
      setCropDraft({ x: pos.x, y: pos.y, w: 0, h: 0 });
      return;
    }

    // Check for drag start on existing text/sticker
    for (const t of [...texts].reverse()) {
      const tw = t.text.length * t.size * 0.6;
      if (pos.x >= t.x - 4 && pos.x <= t.x + tw && pos.y >= t.y - t.size && pos.y <= t.y + 4) {
        setDragItem({ type: "text", id: t.id, ox: pos.x - t.x, oy: pos.y - t.y });
        return;
      }
    }
    for (const s of [...stickers].reverse()) {
      if (pos.x >= s.x && pos.x <= s.x + s.size && pos.y >= s.y - s.size && pos.y <= s.y + 4) {
        setDragItem({ type: "sticker", id: s.id, ox: pos.x - s.x, oy: pos.y - s.y });
        return;
      }
    }
  };

  const onCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e);

    if (activeTool === "crop" && cropStartRef.current) {
      const start = cropStartRef.current;
      setCropDraft({
        x: Math.min(start.x, pos.x),
        y: Math.min(start.y, pos.y),
        w: Math.abs(pos.x - start.x),
        h: Math.abs(pos.y - start.y),
      });
      return;
    }

    if (dragItem) {
      if (dragItem.type === "text") {
        setTexts((prev) => prev.map((t) =>
          t.id === dragItem.id ? { ...t, x: pos.x - dragItem.ox, y: pos.y - dragItem.oy } : t,
        ));
      } else {
        setStickers((prev) => prev.map((s) =>
          s.id === dragItem.id ? { ...s, x: pos.x - dragItem.ox, y: pos.y - dragItem.oy } : s,
        ));
      }
    }
  };

  const onCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool === "crop" && cropDraft && cropDraft.w > 10 && cropDraft.h > 10) {
      const pos = getCanvasPos(e);
      const start = cropStartRef.current;
      if (start) {
        const rect: CropRect = {
          x: Math.min(start.x, pos.x) / CANVAS_W * (imgRef.current?.naturalWidth ?? CANVAS_W),
          y: Math.min(start.y, pos.y) / CANVAS_H * (imgRef.current?.naturalHeight ?? CANVAS_H),
          w: Math.abs(pos.x - start.x) / CANVAS_W * (imgRef.current?.naturalWidth ?? CANVAS_W),
          h: Math.abs(pos.y - start.y) / CANVAS_H * (imgRef.current?.naturalHeight ?? CANVAS_H),
        };
        setCropRect(rect);
      }
      setCropDraft(null);
      cropStartRef.current = null;
      setActiveTool("none");
      return;
    }
    cropStartRef.current = null;
    setDragItem(null);

    // Place text on click
    if (activeTool === "text" && textInput.trim()) {
      const pos = getCanvasPos(e);
      setTexts((prev) => [...prev, {
        id: crypto.randomUUID(),
        text: textInput.trim(),
        x: pos.x,
        y: pos.y,
        size: textSize,
        color: textColor,
      }]);
      setTextInput("");
      setActiveTool("none");
    }
  };

  const handleAddSticker = (emoji: string) => {
    setStickers((prev) => [...prev, {
      id: crypto.randomUUID(),
      emoji,
      x: CANVAS_W / 2 - 24,
      y: CANVAS_H / 2 + 24,
      size: 48,
    }]);
    setActiveTool("none");
  };

  const handleExport = () => {
    // Draw final composite without selection draft
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `photo_${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const handleCropReset = () => {
    setCropRect(null);
    setCropDraft(null);
    cropStartRef.current = null;
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 501,
      background: "rgba(4,3,12,0.96)",
      display: "flex",
      flexDirection: "column",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Top bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: "1px solid rgba(120,80,255,0.25)",
        flexShrink: 0,
      }}>
        <button type="button" onClick={onRetake} style={edBtnStyle}>
          ← 重拍
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={handleExport} style={{ ...edBtnStyle, background: "rgba(120,80,255,0.3)", border: "1px solid rgba(160,100,255,0.5)" }}>
            导出
          </button>
          <button type="button" onClick={onClose} style={edBtnStyle}>
            ×
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: "8px 0" }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            borderRadius: 6,
            cursor: activeTool === "crop" ? "crosshair" : activeTool === "text" ? "text" : dragItem ? "grabbing" : "grab",
          }}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={() => { setDragItem(null); cropStartRef.current = null; setCropDraft(null); }}
        />
      </div>

      {/* Bottom panel */}
      <div style={{
        borderTop: "1px solid rgba(120,80,255,0.25)",
        background: "rgba(8,6,20,0.9)",
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        flexShrink: 0,
        maxHeight: "42vh",
        overflowY: "auto",
      }}>
        {/* Filters */}
        <div>
          <div style={sectionLabel}>滤镜</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                style={{
                  ...chipStyle,
                  background: filter === f.id ? "rgba(120,80,255,0.4)" : "rgba(255,255,255,0.07)",
                  border: filter === f.id ? "1px solid rgba(160,100,255,0.7)" : "1px solid rgba(255,255,255,0.12)",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Adjustments */}
        <div>
          <div style={sectionLabel}>调整</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <SliderRow label="亮度" value={brightness} onChange={setBrightness} />
            <SliderRow label="对比度" value={contrast} onChange={setContrast} />
            <SliderRow label="饱和度" value={saturation} onChange={setSaturation} />
          </div>
        </div>

        {/* Tools */}
        <div>
          <div style={sectionLabel}>工具</div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                if (activeTool === "crop") { setActiveTool("none"); }
                else { setActiveTool("crop"); }
              }}
              style={{ ...chipStyle, background: activeTool === "crop" ? "rgba(120,80,255,0.4)" : "rgba(255,255,255,0.07)" }}
            >
              ✂ 裁剪{cropRect ? " (已裁)" : ""}
            </button>
            {cropRect && (
              <button type="button" onClick={handleCropReset} style={{ ...chipStyle, fontSize: 11 }}>
                重置裁剪
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTool(activeTool === "text" ? "none" : "text")}
              style={{ ...chipStyle, background: activeTool === "text" ? "rgba(120,80,255,0.4)" : "rgba(255,255,255,0.07)" }}
            >
              T 文字
            </button>
            <button
              type="button"
              onClick={() => setActiveTool(activeTool === "sticker" ? "none" : "sticker")}
              style={{ ...chipStyle, background: activeTool === "sticker" ? "rgba(120,80,255,0.4)" : "rgba(255,255,255,0.07)" }}
            >
              贴纸
            </button>
          </div>

          {/* Text input */}
          {activeTool === "text" && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="输入文字，点击画面放置"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                style={{
                  flex: 1, minWidth: 160,
                  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 6, padding: "5px 10px", color: "#fff", fontSize: 13,
                  outline: "none",
                }}
              />
              <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)}
                style={{ width: 28, height: 28, border: "none", borderRadius: 4, cursor: "pointer", background: "none" }} />
              <input type="range" min={16} max={64} value={textSize} onChange={(e) => setTextSize(Number(e.target.value))}
                style={{ width: 80, accentColor: "#a07aff" }} />
            </div>
          )}

          {/* Sticker picker */}
          {activeTool === "sticker" && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {STICKERS.map((emoji) => (
                <button key={emoji} type="button" onClick={() => handleAddSticker(emoji)}
                  style={{ fontSize: 24, background: "none", border: "none", cursor: "pointer", lineHeight: 1 }}>
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SliderRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ color: "rgba(190,175,240,0.8)", fontSize: 12, width: 42, flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={-100}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "#a07aff" }}
      />
      <span style={{ color: "rgba(190,175,240,0.6)", fontSize: 11, width: 28, textAlign: "right" }}>{value > 0 ? `+${value}` : value}</span>
    </div>
  );
}

const edBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 8,
  color: "rgba(210,195,255,0.9)",
  fontSize: 14,
  cursor: "pointer",
  padding: "6px 14px",
  fontFamily: "system-ui",
};

const chipStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  color: "rgba(210,195,255,0.85)",
  fontSize: 13,
  cursor: "pointer",
  padding: "4px 10px",
  fontFamily: "system-ui",
};

const sectionLabel: React.CSSProperties = {
  color: "rgba(160,145,220,0.7)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.8,
  marginBottom: 6,
  fontFamily: "system-ui",
};
