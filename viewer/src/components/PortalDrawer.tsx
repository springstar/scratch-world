import { useState, useEffect, useCallback } from "react";
import { fetchSceneList, type SceneListItem } from "../api.js";

interface Props {
  open: boolean;
  onClose: () => void;
  currentSceneId: string | undefined;
  onPlace: (portal: { name?: string; targetSceneId?: string; targetSceneName?: string }) => void;
}

export function PortalDrawer({ open, onClose, currentSceneId, onPlace }: Props) {
  const [scenes, setScenes] = useState<SceneListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [portalName, setPortalName] = useState("");

  const loadScenes = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchSceneList();
      setScenes(list.filter((s) => s.sceneId !== currentSceneId && s.status === "ready"));
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [currentSceneId]);

  useEffect(() => {
    if (open) {
      setSelectedSceneId(null);
      setPortalName("");
      void loadScenes();
    }
  }, [open, loadScenes]);

  if (!open) return null;

  const selectedScene = scenes.find((s) => s.sceneId === selectedSceneId);

  const handlePlace = () => {
    onPlace({
      name: portalName.trim() || undefined,
      targetSceneId: selectedSceneId ?? undefined,
      targetSceneName: selectedScene?.title ?? undefined,
    });
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 320,
        height: "100%",
        background: "rgba(10,8,24,0.96)",
        backdropFilter: "blur(16px)",
        borderLeft: "1px solid rgba(120,80,255,0.2)",
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 18px 12px",
          borderBottom: "1px solid rgba(120,80,255,0.15)",
        }}
      >
        <span style={{ color: "rgba(200,180,255,0.95)", fontSize: 15, fontWeight: 600 }}>
          传送门
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "rgba(160,140,220,0.7)",
            fontSize: 18,
            cursor: "pointer",
            lineHeight: 1,
            padding: "0 2px",
          }}
        >
          ×
        </button>
      </div>

      {/* Portal name */}
      <div style={{ padding: "14px 18px 0" }}>
        <label style={{ display: "block", color: "rgba(170,150,240,0.8)", fontSize: 12, marginBottom: 6 }}>
          传送门名称（选填）
        </label>
        <input
          type="text"
          placeholder="传送门"
          value={portalName}
          onChange={(e) => setPortalName(e.target.value)}
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(120,80,255,0.25)",
            borderRadius: 7,
            padding: "8px 10px",
            color: "rgba(210,200,255,0.9)",
            fontSize: 13,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Target scene picker */}
      <div style={{ padding: "14px 18px 0", flex: 1, overflowY: "auto" }}>
        <div style={{ color: "rgba(170,150,240,0.8)", fontSize: 12, marginBottom: 10 }}>
          选择目标场景（选填 — 不选则进入时可选择）
        </div>

        {loading ? (
          <div style={{ color: "rgba(150,130,220,0.6)", fontSize: 13, textAlign: "center", marginTop: 20 }}>
            加载中…
          </div>
        ) : scenes.length === 0 ? (
          <div style={{ color: "rgba(150,130,220,0.5)", fontSize: 13, textAlign: "center", marginTop: 20 }}>
            暂无其他场景
          </div>
        ) : (
          <>
            {/* "No target" option */}
            <div
              onClick={() => setSelectedSceneId(null)}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: selectedSceneId === null ? "rgba(100,60,220,0.25)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${selectedSceneId === null ? "rgba(140,90,255,0.5)" : "rgba(255,255,255,0.06)"}`,
                marginBottom: 6,
                cursor: "pointer",
                color: "rgba(180,160,255,0.75)",
                fontSize: 13,
              }}
            >
              不指定目标
            </div>

            {scenes.map((s) => (
              <div
                key={s.sceneId}
                onClick={() => setSelectedSceneId(s.sceneId)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: selectedSceneId === s.sceneId ? "rgba(100,60,220,0.25)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${selectedSceneId === s.sceneId ? "rgba(140,90,255,0.5)" : "rgba(255,255,255,0.06)"}`,
                  marginBottom: 6,
                  cursor: "pointer",
                }}
              >
                <div style={{ color: "rgba(210,200,255,0.9)", fontSize: 13, fontWeight: 500 }}>
                  {s.title || s.sceneId}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Action buttons */}
      <div
        style={{
          padding: "14px 18px",
          borderTop: "1px solid rgba(120,80,255,0.15)",
          display: "flex",
          gap: 10,
        }}
      >
        <button
          onClick={handlePlace}
          style={{
            flex: 1,
            background: "rgba(100,50,220,0.5)",
            border: "1px solid rgba(140,90,255,0.4)",
            borderRadius: 8,
            padding: "10px 0",
            color: "rgba(220,210,255,0.95)",
            fontSize: 14,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          放置传送门
        </button>
        <button
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "10px 14px",
            color: "rgba(180,160,220,0.7)",
            fontSize: 14,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
