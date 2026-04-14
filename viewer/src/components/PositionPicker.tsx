import { useCallback, useEffect, useRef, useState } from "react";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Props {
  panoUrl: string;
  objectName: string;
  estimatedPos: Vec3;
  pickerId: string;
  onConfirm: (pos: Vec3) => void;
  onSkip: () => void;
}

const EYE_HEIGHT = 1.6; // metres

function worldToPano(pos: Vec3): { bx: number; by: number } {
  const azimuth = Math.atan2(pos.x, -pos.z);
  const flatDist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
  const elevation = Math.atan2(pos.y - EYE_HEIGHT, flatDist);
  const bx = azimuth / (2 * Math.PI) + 0.5;
  const by = 0.5 - elevation / Math.PI;
  return { bx, by };
}

function panoToWorld(bx: number, by: number, baseDist = 3.0): Vec3 {
  const azimuth = (bx - 0.5) * 2 * Math.PI;
  const elevation = (0.5 - by) * Math.PI;
  const flatDist = baseDist * Math.cos(elevation);
  const x = Math.sin(azimuth) * flatDist;
  const z = -Math.cos(azimuth) * flatDist;
  const y = EYE_HEIGHT + Math.sin(elevation) * baseDist;
  return { x, y, z };
}

export function PositionPicker({ panoUrl, objectName, estimatedPos, onConfirm, onSkip }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pickedPos, setPickedPos] = useState<Vec3 | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  // Draw markers on canvas whenever image or picked position changes
  const drawMarkers = useCallback(
    (w: number, h: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      const { bx: ebx, by: eby } = worldToPano(estimatedPos);
      const ex = ebx * w;
      const ey = eby * h;

      // Draw estimated position — dashed red circle
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(255,80,80,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ex, ey, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      // Crosshair
      ctx.save();
      ctx.strokeStyle = "rgba(255,80,80,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ex - 18, ey);
      ctx.lineTo(ex + 18, ey);
      ctx.moveTo(ex, ey - 18);
      ctx.lineTo(ex, ey + 18);
      ctx.stroke();
      ctx.restore();
      // Label
      ctx.save();
      ctx.font = "12px system-ui";
      ctx.fillStyle = "rgba(255,80,80,0.9)";
      ctx.fillText("估计位置", ex + 16, ey - 8);
      ctx.restore();

      if (pickedPos) {
        const { bx: pbx, by: pby } = worldToPano(pickedPos);
        const px = pbx * w;
        const py = pby * h;
        // Solid green circle
        ctx.save();
        ctx.strokeStyle = "rgba(80,255,120,1)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(px, py, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = "rgba(80,255,120,1)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px - 18, py);
        ctx.lineTo(px + 18, py);
        ctx.moveTo(px, py - 18);
        ctx.lineTo(px, py + 18);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.font = "12px system-ui";
        ctx.fillStyle = "rgba(80,255,120,1)";
        ctx.fillText("已选位置", px + 16, py - 8);
        ctx.restore();
      }
    },
    [estimatedPos, pickedPos],
  );

  useEffect(() => {
    if (imgLoaded && imgSize.w > 0) {
      drawMarkers(imgSize.w, imgSize.h);
    }
  }, [imgLoaded, imgSize, drawMarkers]);

  const handleImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    setImgSize({ w: rect.width, h: rect.height });
    setImgLoaded(true);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const bx = clickX / rect.width;
      const by = clickY / rect.height;
      // Preserve original distance from estimatedPos
      const origDist = Math.sqrt(
        estimatedPos.x * estimatedPos.x + estimatedPos.z * estimatedPos.z,
      );
      const baseDist = origDist > 0.5 ? origDist : 3.0;
      const newPos = panoToWorld(bx, by, baseDist);
      setPickedPos(newPos);
    },
    [estimatedPos],
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 9000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        style={{
          background: "#1a1a2e",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: "12px",
          padding: "16px",
          maxWidth: "90vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#e0d0ff", fontSize: "14px", fontWeight: 600 }}>
            确认放置位置 — {objectName}
          </span>
          <button
            onClick={onSkip}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              fontSize: "18px",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <p style={{ color: "#999", fontSize: "12px", margin: 0 }}>
          红色标记为估计位置。点击全景图中的目标位置来纠正，然后点击确认。
        </p>

        {/* Panorama + canvas overlay */}
        <div style={{ position: "relative", maxWidth: "80vw", maxHeight: "55vh", overflow: "hidden", borderRadius: "8px" }}>
          <img
            ref={imgRef}
            src={panoUrl}
            alt="panorama"
            onLoad={handleImgLoad}
            style={{ display: "block", maxWidth: "80vw", maxHeight: "55vh", objectFit: "contain" }}
          />
          {imgLoaded && (
            <canvas
              ref={canvasRef}
              width={imgSize.w}
              height={imgSize.h}
              onClick={handleClick}
              style={{
                position: "absolute",
                inset: 0,
                cursor: "crosshair",
                width: imgSize.w,
                height: imgSize.h,
              }}
            />
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            onClick={onSkip}
            style={{
              padding: "8px 16px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "6px",
              color: "#aaa",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            跳过
          </button>
          <button
            onClick={() => onConfirm(pickedPos ?? estimatedPos)}
            style={{
              padding: "8px 16px",
              background: pickedPos ? "rgba(80,200,120,0.2)" : "rgba(100,100,255,0.2)",
              border: `1px solid ${pickedPos ? "rgba(80,200,120,0.5)" : "rgba(100,100,255,0.4)"}`,
              borderRadius: "6px",
              color: pickedPos ? "#80e8a0" : "#a0a0ff",
              fontSize: "13px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {pickedPos ? "确认新位置" : "使用估计位置"}
          </button>
        </div>
      </div>
    </div>
  );
}
