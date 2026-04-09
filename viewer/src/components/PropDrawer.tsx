import { useRef, useState } from "react";
import { generateProp, pollGenerateProp, type GeneratePropJobStatus } from "../api.js";
import type { SceneObject, SceneResponse } from "../types.js";

export interface PendingProp {
  name: string;
  description: string;
  modelUrl: string;
  scale: number;
  /** Set when re-placing an existing prop (position-only update, no new prop created). */
  objectId?: string;
}

export interface GeneratedProp {
  jobId: string;
  name: string;
  description: string;
  modelUrl: string;
  thumbnailUrl: string | null;
  scale: number;
}

interface PropDrawerProps {
  open: boolean;
  onClose: () => void;
  scene: SceneResponse | null;
  sessionId: string;
  /** Controlled: persisted generated-prop library passed from App. */
  generatedProps: GeneratedProp[];
  /** Called when a new prop finishes generating — parent appends to library. */
  onPropGenerated: (prop: GeneratedProp) => void;
  onBeginPlacement: (prop: PendingProp) => void;
}

type InputTab = "text" | "image";
type Quality = "fast" | "balanced" | "quality";
type GenStatus = "idle" | "generating" | "error";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(140,100,255,0.25)",
  borderRadius: 7,
  color: "rgba(220,235,255,0.95)",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(160,180,255,0.7)",
  marginBottom: 4,
  display: "block",
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: "8px 0",
  background: "rgba(100,140,255,0.25)",
  border: "1px solid rgba(100,140,255,0.5)",
  borderRadius: 7,
  color: "rgba(200,220,255,0.95)",
  fontSize: 13,
  cursor: "pointer",
  width: "100%",
};

const BTN_GHOST: React.CSSProperties = {
  padding: "6px 12px",
  background: "transparent",
  border: "1px solid rgba(150,150,180,0.3)",
  borderRadius: 6,
  color: "rgba(160,170,200,0.7)",
  fontSize: 12,
  cursor: "pointer",
};

const CREDIT_COST: Record<Quality, number> = { fast: 10, balanced: 20, quality: 35 };

export function PropDrawer({ open, onClose, scene, sessionId, generatedProps, onPropGenerated, onBeginPlacement }: PropDrawerProps) {
  const [tab, setTab] = useState<InputTab>("text");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>("balanced");
  const [genStatus, setGenStatus] = useState<GenStatus>("idle");
  const [genError, setGenError] = useState("");
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Existing props from the scene
  const existingProps = scene?.sceneData.objects.filter((o) => o.type === "prop") ?? [];

  const drawerStyle: React.CSSProperties = {
    position: "fixed",
    left: 0,
    top: 0,
    bottom: 0,
    width: 340,
    transform: open ? "translateX(0)" : "translateX(-100%)",
    transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)",
    zIndex: 130,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    background: "rgba(12,10,28,0.92)",
    backdropFilter: "blur(16px)",
    borderRight: "1px solid rgba(100,80,200,0.25)",
    boxShadow: "4px 0 32px rgba(0,0,0,0.6)",
    fontFamily: "system-ui, -apple-system, sans-serif",
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setImageFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
  };

  const handleGenerate = async () => {
    if (!scene) return;
    if (tab === "text" && !description.trim()) return;
    if (tab === "image" && !imageFile) return;

    setGenStatus("generating");
    setGenError("");

    try {
      let payload: Parameters<typeof generateProp>[2];
      if (tab === "text") {
        payload = { description: description.trim(), quality };
      } else {
        // Read image as base64
        const base64 = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onload = (ev) => res((ev.target?.result as string).split(",")[1]);
          reader.onerror = rej;
          reader.readAsDataURL(imageFile!);
        });
        payload = { imageBase64: base64, imageMimeType: imageFile!.type, quality };
      }

      const { jobId } = await generateProp(scene.sceneId, sessionId, payload);
      pollJob(scene.sceneId, jobId);
    } catch (err) {
      setGenStatus("error");
      setGenError(err instanceof Error ? err.message : "Generation failed");
    }
  };

  const pollJob = (sceneId: string, jobId: string) => {
    const check = async () => {
      try {
        const result: GeneratePropJobStatus = await pollGenerateProp(sceneId, jobId);
        if (result.status === "pending") {
          pollTimerRef.current = setTimeout(check, 1500);
          return;
        }
        if (result.status === "done") {
          onPropGenerated({
            jobId,
            name: result.name,
            description: description.trim() || "Generated prop",
            modelUrl: result.modelUrl,
            thumbnailUrl: result.thumbnailUrl,
            scale: result.scale,
          });
          setGenStatus("idle");
          setDescription("");
          setImageFile(null);
          setImagePreview(null);
        } else {
          setGenStatus("error");
          setGenError(result.error ?? "Generation failed");
        }
      } catch (err) {
        setGenStatus("error");
        setGenError(err instanceof Error ? err.message : "Poll failed");
      }
    };
    pollTimerRef.current = setTimeout(check, 1500);
  };

  const handlePlace = (prop: GeneratedProp | SceneObject) => {
    if ("modelUrl" in prop && typeof prop.modelUrl === "string") {
      // GeneratedProp
      onBeginPlacement({
        name: prop.name,
        description: prop.description,
        modelUrl: prop.modelUrl,
        scale: prop.scale,
      });
    } else {
      // SceneObject (re-placing existing prop)
      const obj = prop as SceneObject;
      const modelUrl = obj.metadata.modelUrl as string;
      const scale = typeof obj.metadata.scale === "number" ? obj.metadata.scale : 1;
      onBeginPlacement({
        name: obj.name,
        description: obj.description,
        modelUrl,
        scale,
        objectId: obj.objectId,
      });
    }
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "7px 0",
    background: active ? "rgba(100,140,255,0.18)" : "transparent",
    border: `1px solid ${active ? "rgba(100,140,255,0.45)" : "rgba(100,80,200,0.2)"}`,
    borderRadius: 6,
    color: active ? "rgba(200,220,255,0.95)" : "rgba(140,150,200,0.6)",
    fontSize: 12,
    cursor: "pointer",
  });

  const qualityBtnStyle = (q: Quality): React.CSSProperties => ({
    flex: 1,
    padding: "5px 0",
    background: quality === q ? "rgba(80,120,255,0.2)" : "transparent",
    border: `1px solid ${quality === q ? "rgba(100,140,255,0.5)" : "rgba(100,80,200,0.2)"}`,
    borderRadius: 5,
    color: quality === q ? "rgba(200,220,255,0.95)" : "rgba(140,150,200,0.55)",
    fontSize: 11,
    cursor: "pointer",
  });

  const isGenerating = genStatus === "generating";
  const canGenerate = !isGenerating && (tab === "text" ? description.trim().length > 0 : !!imageFile);

  return (
    <div style={drawerStyle}>
      {/* Header */}
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(100,80,200,0.18)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(200,220,255,0.92)" }}>物件生成</span>
        <button onClick={onClose} style={{ ...BTN_GHOST, padding: "3px 8px", fontSize: 16 }}>×</button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Generation form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Tab selector */}
          <div style={{ display: "flex", gap: 6 }}>
            <button style={tabStyle(tab === "text")} onClick={() => setTab("text")}>文字描述</button>
            <button style={tabStyle(tab === "image")} onClick={() => setTab("image")}>上传图片</button>
          </div>

          {tab === "text" ? (
            <div>
              <label style={LABEL_STYLE}>描述物件</label>
              <textarea
                style={{ ...INPUT_STYLE, minHeight: 72, resize: "vertical" }}
                placeholder="例：一张做旧的实木书桌，表面有划痕"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isGenerating}
              />
            </div>
          ) : (
            <div>
              <label style={LABEL_STYLE}>参考图片</label>
              <div
                style={{
                  border: "1px dashed rgba(140,100,255,0.35)",
                  borderRadius: 8,
                  padding: "14px",
                  textAlign: "center",
                  cursor: isGenerating ? "default" : "pointer",
                  color: "rgba(140,150,200,0.6)",
                  fontSize: 12,
                  background: "rgba(255,255,255,0.03)",
                }}
                onClick={() => !isGenerating && fileInputRef.current?.click()}
              >
                {imagePreview ? (
                  <img src={imagePreview} alt="preview" style={{ maxWidth: "100%", maxHeight: 120, borderRadius: 4, objectFit: "contain" }} />
                ) : (
                  <span>点击选择图片</span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFileChange}
                disabled={isGenerating}
              />
            </div>
          )}

          {/* Quality selector */}
          <div>
            <label style={LABEL_STYLE}>质量</label>
            <div style={{ display: "flex", gap: 5 }}>
              {(["fast", "balanced", "quality"] as Quality[]).map((q) => (
                <button key={q} style={qualityBtnStyle(q)} onClick={() => setQuality(q)} disabled={isGenerating}>
                  {{ fast: "快速", balanced: "均衡", quality: "精细" }[q]}
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button
            style={{
              ...BTN_PRIMARY,
              opacity: canGenerate ? 1 : 0.45,
              cursor: canGenerate ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
            onClick={handleGenerate}
            disabled={!canGenerate}
          >
            {isGenerating ? (
              <>
                <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(200,220,255,0.3)", borderTopColor: "rgba(200,220,255,0.9)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                生成中...
              </>
            ) : (
              `生成 (${CREDIT_COST[quality]} 积分)`
            )}
          </button>

          {genStatus === "error" && (
            <div style={{ fontSize: 12, color: "rgba(255,120,120,0.85)", padding: "6px 8px", background: "rgba(255,60,60,0.08)", borderRadius: 5, border: "1px solid rgba(255,80,80,0.2)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>{genError}</span>
              <button onClick={handleGenerate} style={{ flexShrink: 0, padding: "2px 8px", background: "rgba(100,140,255,0.2)", border: "1px solid rgba(100,140,255,0.4)", borderRadius: 4, color: "rgba(180,200,255,0.9)", fontSize: 11, cursor: "pointer" }}>重试</button>
            </div>
          )}
        </div>

        {/* Generated props */}
        {generatedProps.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "rgba(120,130,180,0.6)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>已生成</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {generatedProps.map((prop) => (
                <PropCard
                  key={prop.jobId}
                  name={prop.name}
                  thumbnailUrl={prop.thumbnailUrl}
                  onPlace={() => handlePlace(prop)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Existing scene props */}
        {existingProps.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "rgba(120,130,180,0.6)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>场景物件</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {existingProps.map((obj) => (
                <PropCard
                  key={obj.objectId}
                  name={obj.name}
                  thumbnailUrl={null}
                  onPlace={() => handlePlace(obj)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function PropCard({
  name,
  thumbnailUrl,
  onPlace,
}: {
  name: string;
  thumbnailUrl: string | null;
  onPlace: () => void;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 10px",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(100,80,200,0.2)",
      borderRadius: 8,
    }}>
      <div style={{
        width: 40,
        height: 40,
        borderRadius: 6,
        background: thumbnailUrl ? undefined : "rgba(80,100,180,0.15)",
        border: "1px solid rgba(100,80,200,0.2)",
        flexShrink: 0,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ fontSize: 18, opacity: 0.4 }}>&#9723;</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "rgba(210,225,255,0.9)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
      </div>
      <button
        onClick={onPlace}
        style={{
          padding: "4px 10px",
          background: "rgba(80,130,255,0.18)",
          border: "1px solid rgba(100,150,255,0.4)",
          borderRadius: 5,
          color: "rgba(180,210,255,0.9)",
          fontSize: 12,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        放置
      </button>
    </div>
  );
}
