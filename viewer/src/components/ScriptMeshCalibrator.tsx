import { useEffect, useState } from "react";
import { patchSceneObjectPosition } from "../api.js";

interface CalibrationMesh {
  position: { set(x: number, y: number, z: number): void; x: number; y: number; z: number };
  scale: { set(x: number, y: number, z: number): void; x: number; y: number; z: number };
}

interface Props {
  meshes: CalibrationMesh[];
  sceneId: string;
  sessionId: string;
  objectId: string;
  cachedCode: string;
  onDone: () => void;
}

// Extract PlaneGeometry(w, h) dimensions from generated code.
function parseGeometry(code: string): { w: number; h: number } {
  const m = code.match(/PlaneGeometry\(\s*([\d.]+)\s*,\s*([\d.]+)/);
  return m ? { w: parseFloat(m[1]), h: parseFloat(m[2]) } : { w: 1.6, h: 0.9 };
}

export function ScriptMeshCalibrator({ meshes, sceneId, sessionId, objectId, cachedCode, onDone }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number; z: number }>(() => {
    const m = meshes[0];
    return m ? { x: m.position.x, y: m.position.y, z: m.position.z } : { x: 0, y: 1.3, z: 0 };
  });
  // Scale relative to original geometry — 1.0 = original LLM size
  const [scale, setScale] = useState({ w: 1.0, h: 1.0 });
  const baseGeom = parseGeometry(cachedCode);
  const [saving, setSaving] = useState(false);

  // Apply position changes to meshes
  useEffect(() => {
    for (const m of meshes) m.position.set(pos.x, pos.y, pos.z);
  }, [meshes, pos]);

  // Apply scale changes to meshes
  useEffect(() => {
    for (const m of meshes) m.scale.set(scale.w, scale.h, 1);
  }, [meshes, scale]);

  function nudgePos(axis: "x" | "y" | "z", delta: number) {
    setPos((prev) => ({ ...prev, [axis]: Math.round((prev[axis] + delta) * 1000) / 1000 }));
  }

  function nudgeScale(axis: "w" | "h", delta: number) {
    setScale((prev) => ({ ...prev, [axis]: Math.max(0.1, Math.round((prev[axis] + delta) * 100) / 100) }));
  }

  async function handleSave() {
    setSaving(true);
    const finalW = Math.round(baseGeom.w * scale.w * 1000) / 1000;
    const finalH = Math.round(baseGeom.h * scale.h * 1000) / 1000;
    let patchedCode = cachedCode
      .replace(
        /mesh\.position\.set\([^)]*\)/g,
        `mesh.position.set(${pos.x.toFixed(4)}, ${pos.y.toFixed(4)}, ${pos.z.toFixed(4)})`,
      )
      .replace(
        /PlaneGeometry\(\s*[\d.]+\s*,\s*[\d.]+/g,
        `PlaneGeometry(${finalW}, ${finalH}`,
      );
    await patchSceneObjectPosition(sceneId, sessionId, objectId, { x: pos.x, y: pos.y, z: pos.z }, {
      autoRun: true,
      cachedCode: patchedCode,
    }, pos.y);
    setSaving(false);
    onDone();
  }

  const btn = (label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        background: "rgba(255,255,255,0.12)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: 4,
        padding: "2px 7px",
        cursor: "pointer",
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      position: "fixed",
      bottom: 80,
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(0,0,0,0.88)",
      color: "#fff",
      borderRadius: 10,
      padding: "14px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      fontSize: 13,
      zIndex: 9999,
      pointerEvents: "auto",
      backdropFilter: "blur(8px)",
      border: "1px solid rgba(255,255,255,0.15)",
      minWidth: 380,
    }}>
      <div style={{ fontWeight: 600 }}>位置 / 大小校准</div>

      {/* Position XYZ */}
      <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>位置</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(["x", "y", "z"] as const).map((axis) => (
          <div key={axis} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, color: axis === "x" ? "#f87171" : axis === "y" ? "#4ade80" : "#60a5fa", fontWeight: 700 }}>{axis.toUpperCase()}</span>
            <span style={{ width: 64, textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
              {pos[axis].toFixed(3)}
            </span>
            {btn("−0.1", () => nudgePos(axis, -0.1))}
            {btn("−0.01", () => nudgePos(axis, -0.01))}
            {btn("+0.01", () => nudgePos(axis, 0.01))}
            {btn("+0.1", () => nudgePos(axis, 0.1))}
          </div>
        ))}
      </div>

      {/* Size W/H */}
      <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 4 }}>大小（当前 {(baseGeom.w * scale.w).toFixed(2)} × {(baseGeom.h * scale.h).toFixed(2)} m）</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(["w", "h"] as const).map((axis) => (
          <div key={axis} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, color: axis === "w" ? "#fb923c" : "#e879f9", fontWeight: 700 }}>{axis.toUpperCase()}</span>
            <span style={{ width: 64, textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
              {scale[axis].toFixed(2)}×
            </span>
            {btn("−0.1", () => nudgeScale(axis, -0.1))}
            {btn("−0.05", () => nudgeScale(axis, -0.05))}
            {btn("+0.05", () => nudgeScale(axis, 0.05))}
            {btn("+0.1", () => nudgeScale(axis, 0.1))}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <button
          onClick={onDone}
          style={{
            background: "rgba(255,255,255,0.1)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 6,
            padding: "6px 14px",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          跳过
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "6px 16px",
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
            fontSize: 13,
          }}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}
