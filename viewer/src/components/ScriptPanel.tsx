import { useState } from "react";
import type { SceneObject, SceneResponse } from "../types.js";
import { regenSkill, deleteSkill, fixSkill } from "../api.js";

interface Props {
  open: boolean;
  onClose: () => void;
  scene: SceneResponse | null;
  sessionId: string;
  generatingObjectId: string | null;
  /** objectId → last runtime error from runScript */
  scriptErrors: Record<string, string>;
  /** Called when user clears an error without fixing */
  onErrorCleared: (objectId: string) => void;
  onRun: (objectId: string) => void;
}

function getCodeGenObjects(scene: SceneResponse | null): SceneObject[] {
  if (!scene) return [];
  return scene.sceneData.objects.filter((o) => {
    const skill = o.metadata?.skill as Record<string, unknown> | undefined;
    return skill?.name === "code-gen";
  });
}

const PANEL: React.CSSProperties = {
  position: "fixed",
  top: 56,
  right: 16,
  width: 320,
  maxHeight: "calc(100vh - 80px)",
  overflowY: "auto",
  background: "rgba(8,6,20,0.93)",
  border: "1px solid rgba(120,80,255,0.35)",
  borderRadius: 10,
  zIndex: 200,
  backdropFilter: "blur(10px)",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "rgba(220,210,255,0.95)",
  fontSize: 13,
};

const INPUT: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(140,100,255,0.25)",
  borderRadius: 7,
  color: "rgba(220,235,255,0.95)",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  resize: "vertical",
};

const BTN: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid rgba(140,100,255,0.3)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(200,210,255,0.9)",
  fontSize: 12,
  cursor: "pointer",
  flexShrink: 0,
};

const BTN_PRIMARY: React.CSSProperties = {
  ...BTN,
  background: "rgba(120,80,255,0.3)",
  border: "1px solid rgba(160,100,255,0.5)",
};

const BTN_DANGER: React.CSSProperties = {
  ...BTN,
  border: "1px solid rgba(255,80,80,0.35)",
  color: "rgba(255,160,160,0.9)",
};

export function ScriptPanel({ open, onClose, scene, sessionId, generatingObjectId, scriptErrors, onErrorCleared, onRun }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  if (!open) return null;

  const objects = getCodeGenObjects(scene);

  function startEdit(e: React.MouseEvent, obj: SceneObject) {
    e.stopPropagation();
    const cfg = ((obj.metadata?.skill as Record<string, unknown>)?.config ?? {}) as Record<string, unknown>;
    setEditPrompt(typeof cfg.prompt === "string" ? cfg.prompt : "");
    setEditingId(obj.objectId);
  }

  async function submitRegen(obj: SceneObject) {
    if (!scene) return;
    setPending(obj.objectId);
    try {
      await regenSkill(scene.sceneId, obj.objectId, editPrompt, sessionId);
    } finally {
      setPending(null);
      setEditingId(null);
    }
  }

  async function autoFix(obj: SceneObject, errorMsg: string) {
    if (!scene) return;
    onErrorCleared(obj.objectId);
    setPending(obj.objectId);
    try {
      await fixSkill(scene.sceneId, obj.objectId, errorMsg, sessionId);
    } finally {
      setPending(null);
    }
  }

  async function handleDelete(e: React.MouseEvent, obj: SceneObject) {
    e.stopPropagation();
    if (!scene) return;
    setPending(obj.objectId);
    try {
      await deleteSkill(scene.sceneId, obj.objectId, sessionId);
    } finally {
      setPending(null);
    }
  }

  return (
    <div style={PANEL}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(120,80,255,0.2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>场景脚本</span>
        <button type="button" onClick={onClose} style={{ ...BTN, padding: "2px 8px" }}>×</button>
      </div>

      {objects.length === 0 ? (
        <div style={{ padding: 16, color: "rgba(160,170,200,0.6)", fontSize: 12 }}>
          当前场景没有已生成的脚本。在聊天中描述需求以创建。
        </div>
      ) : (
        <div style={{ padding: 8 }}>
          {objects.map((obj) => {
            const skill = (obj.metadata?.skill ?? {}) as Record<string, unknown>;
            const cfg = (skill.config ?? {}) as Record<string, unknown>;
            const hasCode = typeof cfg.cachedCode === "string";
            const isGenerating = generatingObjectId === obj.objectId;
            const isBusy = pending === obj.objectId;
            const isEditing = editingId === obj.objectId;
            const errorMsg = scriptErrors[obj.objectId] ?? null;

            let statusColor = "rgba(160,170,200,0.5)";
            let statusLabel = "无代码";
            if (isGenerating) { statusColor = "rgba(200,160,80,0.9)"; statusLabel = "生成中..."; }
            else if (errorMsg) { statusColor = "rgba(255,100,100,0.9)"; statusLabel = "执行出错"; }
            else if (hasCode) { statusColor = "rgba(80,200,120,0.9)"; statusLabel = "就绪"; }

            const rowClickable = hasCode && !isGenerating && !isEditing;

            return (
              <div
                key={obj.objectId}
                onClick={rowClickable ? () => { onRun(obj.objectId); onClose(); } : undefined}
                style={{
                  marginBottom: 8,
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 8,
                  border: `1px solid ${rowClickable ? "rgba(120,80,255,0.35)" : "rgba(120,80,255,0.12)"}`,
                  cursor: rowClickable ? "pointer" : "default",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => { if (rowClickable) (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(160,100,255,0.6)"; }}
                onMouseLeave={(e) => { if (rowClickable) (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(120,80,255,0.35)"; }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isEditing ? 8 : 0 }}>
                  <span style={{ fontWeight: 500 }}>{obj.name}</span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: statusColor }}>{statusLabel}</span>
                    {!isEditing && (
                      <>
                        <button
                          type="button"
                          style={BTN}
                          onClick={(e) => startEdit(e, obj)}
                          disabled={isGenerating || isBusy}
                          title={hasCode ? "改进提示词并重新生成" : "输入需求生成代码"}
                        >
                          {hasCode ? "改进" : "生成"}
                        </button>
                        <button
                          type="button"
                          style={BTN_DANGER}
                          disabled={isBusy}
                          onClick={(e) => handleDelete(e, obj)}
                          title="删除此脚本技能"
                        >
                          {isBusy ? "..." : "删除"}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <textarea
                      style={{ ...INPUT, minHeight: 72, marginBottom: 6 }}
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      placeholder="描述改进需求..."
                      autoFocus
                    />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" style={BTN_PRIMARY} disabled={isBusy || !editPrompt.trim()} onClick={() => submitRegen(obj)}>
                        {isBusy ? "提交中..." : "重新生成"}
                      </button>
                      <button type="button" style={BTN} onClick={() => setEditingId(null)}>取消</button>
                    </div>
                  </div>
                )}

                {!isEditing && errorMsg && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginTop: 8, padding: "7px 10px", background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,80,80,0.25)", borderRadius: 6 }}
                  >
                    <div style={{ fontSize: 11, color: "rgba(255,160,160,0.9)", marginBottom: 6, wordBreak: "break-all" }}>
                      {errorMsg}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        style={{ ...BTN_PRIMARY, fontSize: 11 }}
                        disabled={isBusy}
                        onClick={() => autoFix(obj, errorMsg)}
                      >
                        {isBusy ? "提交中..." : "自动修复"}
                      </button>
                      <button
                        type="button"
                        style={{ ...BTN, fontSize: 11 }}
                        onClick={(e) => { e.stopPropagation(); onErrorCleared(obj.objectId); }}
                      >
                        忽略
                      </button>
                    </div>
                  </div>
                )}

                {!isEditing && !hasCode && !isGenerating && (
                  <div style={{ marginTop: 4, fontSize: 11, color: "rgba(160,170,200,0.5)" }}>
                    点击「生成」输入需求
                  </div>
                )}
                {!isEditing && isGenerating && (
                  <div style={{ marginTop: 4, fontSize: 11, color: "rgba(200,160,80,0.6)" }}>
                    代码生成完成后可点击运行
                  </div>
                )}
                {!isEditing && hasCode && (
                  <div style={{ marginTop: 4, fontSize: 11, color: "rgba(120,140,180,0.5)" }}>
                    点击行执行
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
