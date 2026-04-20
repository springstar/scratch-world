import { useState, useRef } from "react";
import type { ResourceNeed, ResourceOption, ResourceChoice } from "../types.js";
import { uploadUserAsset, userAssetToOption } from "../api.js";

interface Props {
  title: string;
  needs: ResourceNeed[];
  sessionId: string;
  onConfirm: (choices: ResourceChoice[]) => void;
  onSkip: () => void;
  onDismiss: () => void;
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 24,
  right: 24,
  zIndex: 350,
  width: 320,
  maxHeight: "72vh",
  overflowY: "auto",
  background: "rgba(8,6,20,0.95)",
  border: "1px solid rgba(120,80,255,0.35)",
  borderRadius: 12,
  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "rgba(220,210,255,0.92)",
  fontSize: 13,
  padding: "16px 14px 14px",
};

const optionBtnBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "7px 9px",
  borderRadius: 8,
  cursor: "pointer",
  border: "1px solid transparent",
  background: "transparent",
  color: "inherit",
  fontSize: 12,
  textAlign: "left",
  transition: "background 0.12s, border-color 0.12s",
};

function OptionButton({
  opt,
  selected,
  onClick,
}: {
  opt: ResourceOption;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...optionBtnBase,
        background: selected ? "rgba(120,80,255,0.22)" : "rgba(255,255,255,0.04)",
        border: selected ? "1px solid rgba(140,100,255,0.6)" : "1px solid rgba(120,80,255,0.15)",
      }}
    >
      {opt.thumbnail && (
        <img
          src={opt.thumbnail}
          alt=""
          style={{ width: 28, height: 28, objectFit: "contain", borderRadius: 4, background: "#111", flexShrink: 0 }}
        />
      )}
      <span style={{ flex: 1 }}>
        <span style={{ fontWeight: selected ? 600 : 400 }}>{opt.name}</span>
        <span style={{ display: "block", color: "rgba(180,160,255,0.55)", fontSize: 10, marginTop: 1 }}>
          {opt.source === "builtin" ? "builtin" : opt.source === "cdn" ? "CDN" : "uploaded"}
        </span>
      </span>
      {selected && (
        <span style={{ color: "rgba(160,120,255,0.9)", fontSize: 14, flexShrink: 0 }}>✓</span>
      )}
    </button>
  );
}

export function ResourcePickerPanel({ title, needs, sessionId, onConfirm, onSkip, onDismiss }: Props) {
  const [selections, setSelections] = useState<Record<string, ResourceOption>>(() => {
    const init: Record<string, ResourceOption> = {};
    for (const need of needs) {
      if (need.suggested) init[need.label] = need.suggested;
      else if (need.options[0]) init[need.label] = need.options[0];
    }
    return init;
  });

  // Extra options added via upload — keyed by need label
  const [uploadedOptions, setUploadedOptions] = useState<Record<string, ResourceOption[]>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function select(label: string, opt: ResourceOption) {
    setSelections((prev) => ({ ...prev, [label]: opt }));
  }

  async function handleUpload(label: string, file: File) {
    setUploading((prev) => ({ ...prev, [label]: true }));
    setUploadError(null);
    try {
      const asset = await uploadUserAsset(sessionId, file);
      const opt = userAssetToOption(asset);
      setUploadedOptions((prev) => ({ ...prev, [label]: [...(prev[label] ?? []), opt] }));
      select(label, opt);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading((prev) => ({ ...prev, [label]: false }));
    }
  }

  function handleConfirm() {
    const choices: ResourceChoice[] = needs
      .filter((n) => selections[n.label])
      .map((n) => ({ label: n.label, option: selections[n.label] }));
    onConfirm(choices);
  }

  const allSelected = needs.every((n) => selections[n.label]);

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{title || "选择资源"}</span>
        <button
          type="button"
          onClick={onDismiss}
          style={{ background: "none", border: "none", color: "rgba(180,160,255,0.6)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <p style={{ color: "rgba(180,160,255,0.65)", fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
        为效果选择纹理资源，或上传自定义文件，或跳过使用程序化生成。
      </p>

      {needs.map((need) => {
        const allOptions = [...need.options, ...(uploadedOptions[need.label] ?? [])];
        return (
          <div key={need.label} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "rgba(180,160,255,0.6)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {need.label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {allOptions.map((opt) => (
                <OptionButton
                  key={opt.id}
                  opt={opt}
                  selected={selections[need.label]?.id === opt.id}
                  onClick={() => select(need.label, opt)}
                />
              ))}
            </div>

            {/* Upload button */}
            <button
              type="button"
              disabled={uploading[need.label]}
              onClick={() => fileInputRefs.current[need.label]?.click()}
              style={{
                marginTop: 6,
                width: "100%",
                padding: "6px 0",
                borderRadius: 7,
                border: "1px dashed rgba(120,80,255,0.3)",
                background: "transparent",
                color: "rgba(160,130,255,0.7)",
                fontSize: 11,
                cursor: uploading[need.label] ? "default" : "pointer",
                opacity: uploading[need.label] ? 0.5 : 1,
              }}
            >
              {uploading[need.label] ? "上传中..." : "上传自定义文件"}
            </button>
            <input
              ref={(el) => { fileInputRefs.current[need.label] = el; }}
              type="file"
              accept={need.kind === "texture" ? "image/*" : need.kind === "model" ? ".glb,.gltf" : "*"}
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(need.label, file);
                e.target.value = "";
              }}
            />
          </div>
        );
      })}

      {uploadError && (
        <div style={{ color: "rgba(255,100,100,0.85)", fontSize: 11, marginBottom: 10 }}>{uploadError}</div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!allSelected}
          style={{
            flex: 1,
            padding: "9px 0",
            borderRadius: 8,
            border: "none",
            background: allSelected ? "rgba(120,80,255,0.75)" : "rgba(120,80,255,0.25)",
            color: allSelected ? "#fff" : "rgba(255,255,255,0.4)",
            fontWeight: 600,
            fontSize: 13,
            cursor: allSelected ? "pointer" : "default",
          }}
        >
          确认并生成
        </button>
        <button
          type="button"
          onClick={onSkip}
          style={{
            padding: "9px 14px",
            borderRadius: 8,
            border: "1px solid rgba(120,80,255,0.2)",
            background: "transparent",
            color: "rgba(180,160,255,0.7)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          跳过
        </button>
      </div>
    </div>
  );
}
