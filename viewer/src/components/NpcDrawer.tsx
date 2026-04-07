import { useEffect, useState } from "react";
import { ASSET_CATALOG, type AssetEntry } from "../renderer/asset-catalog.js";
import { addSceneNpc, removeSceneNpc, updateSceneNpc, fetchNpcEvolution, approveNpcEvolution, rejectNpcEvolution, type EvolutionLogEntry } from "../api.js";
import type { SceneObject, SceneResponse } from "../types.js";

interface NpcDrawerProps {
  open: boolean;
  onClose: () => void;
  scene: SceneResponse | null;
  sessionId: string;
  onNpcAdded: () => void;
  onNpcUpdated: () => void;
  onNpcDeleted: () => void;
}

type View = "list" | "add" | "edit";
type ModelTab = "catalog" | "url";

const CHARACTER_MODELS: AssetEntry[] = ASSET_CATALOG.filter((a) => a.type === "character");

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

const BTN_DANGER: React.CSSProperties = {
  ...BTN_GHOST,
  border: "1px solid rgba(255,80,80,0.35)",
  color: "rgba(255,130,130,0.8)",
};

export function NpcDrawer({
  open,
  onClose,
  scene,
  sessionId,
  onNpcAdded,
  onNpcUpdated,
  onNpcDeleted,
}: NpcDrawerProps) {
  const [view, setView] = useState<View>("list");
  const [editTarget, setEditTarget] = useState<SceneObject | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Add form state
  const [addName, setAddName] = useState("");
  const [addPersonality, setAddPersonality] = useState("");
  const [addTraits, setAddTraits] = useState("");
  const [modelTab, setModelTab] = useState<ModelTab>("catalog");
  const [selectedModel, setSelectedModel] = useState<AssetEntry | null>(null);
  const [cdnUrl, setCdnUrl] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editPersonality, setEditPersonality] = useState("");
  const [editTraits, setEditTraits] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Evolution log state
  const [evolutionLog, setEvolutionLog] = useState<EvolutionLogEntry[]>([]);
  const [interactionCount, setInteractionCount] = useState(0);
  const [evolutionLoading, setEvolutionLoading] = useState(false);
  const [evolutionActionId, setEvolutionActionId] = useState<string | null>(null);

  useEffect(() => {
    if (view !== "edit" || !editTarget || !scene) return;
    setEvolutionLoading(true);
    fetchNpcEvolution(scene.sceneId, editTarget.objectId)
      .then((data) => {
        setEvolutionLog(data.log);
        setInteractionCount(data.interactionCount);
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setEvolutionLoading(false));
  }, [view, editTarget, scene]);

  const npcs = scene?.sceneData.objects.filter((o) => o.type === "npc") ?? [];

  const resetAdd = () => {
    setAddName("");
    setAddPersonality("");
    setAddTraits("");
    setSelectedModel(null);
    setCdnUrl("");
    setModelSearch("");
    setModelTab("catalog");
    setAddError("");
  };

  const openAdd = () => { resetAdd(); setView("add"); };
  const openEdit = (npc: SceneObject) => {
    setEditTarget(npc);
    setEditName(npc.name);
    setEditPersonality((npc.metadata.npcPersonality as string | undefined) ?? "");
    setEditTraits((npc.metadata.npcTraits as string | undefined) ?? "");
    setEditError("");
    setView("edit");
  };
  const backToList = () => { setView("list"); setEditTarget(null); setDeleteConfirm(null); };

  const handleAdd = async () => {
    if (!scene) return;
    const modelUrl = modelTab === "catalog" ? selectedModel?.url : cdnUrl.trim();
    if (!addName.trim()) { setAddError("请填写名字"); return; }
    if (!addPersonality.trim()) { setAddError("请填写性格"); return; }
    if (!modelUrl) { setAddError("请选择或输入 3D 模型"); return; }

    const rawClick = (window as unknown as Record<string, unknown>).__clickPosition as
      | { x: number; y: number; z: number; ts: number }
      | undefined;
    const playerPos = (window as unknown as Record<string, unknown>).__playerPosition as
      | { x: number; y: number; z: number }
      | undefined;
    const clickPos = rawClick && Date.now() - rawClick.ts < 30_000
      ? { x: rawClick.x, y: rawClick.y, z: rawClick.z }
      : undefined;

    setAdding(true);
    setAddError("");
    try {
      await addSceneNpc(scene.sceneId, sessionId, {
        name: addName.trim(),
        personality: addPersonality.trim(),
        traits: addTraits.trim() || undefined,
        modelUrl,
        scale: modelTab === "catalog" ? (selectedModel?.scale ?? 1) : 1,
        placement: clickPos ? "exact" : "near_camera",
        playerPosition: clickPos ?? playerPos,
      });
      backToList();
      onNpcAdded();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "添加失败");
    } finally {
      setAdding(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!scene || !editTarget) return;
    if (!editName.trim()) { setEditError("名字不能为空"); return; }
    if (!editPersonality.trim()) { setEditError("性格不能为空"); return; }
    setSaving(true);
    setEditError("");
    try {
      await updateSceneNpc(scene.sceneId, sessionId, editTarget.objectId, {
        name: editName.trim(),
        personality: editPersonality.trim(),
        traits: editTraits.trim() || undefined,
      });
      backToList();
      onNpcUpdated();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleApproveEvolution = async (entryId: string) => {
    if (!scene || !editTarget) return;
    setEvolutionActionId(entryId);
    try {
      const result = await approveNpcEvolution(scene.sceneId, sessionId, editTarget.objectId, entryId);
      setEvolutionLog((prev) => prev.map((e) => e.id === entryId ? { ...e, status: "approved", appliedAt: Date.now() } : e));
      setEditPersonality(result.newPersonality);
      onNpcUpdated();
    } catch (err) {
      console.error("[NpcDrawer] approve error:", err);
    } finally {
      setEvolutionActionId(null);
    }
  };

  const handleRejectEvolution = async (entryId: string) => {
    if (!scene || !editTarget) return;
    setEvolutionActionId(entryId);
    try {
      await rejectNpcEvolution(scene.sceneId, sessionId, editTarget.objectId, entryId);
      setEvolutionLog((prev) => prev.map((e) => e.id === entryId ? { ...e, status: "rejected" } : e));
    } catch (err) {
      console.error("[NpcDrawer] reject error:", err);
    } finally {
      setEvolutionActionId(null);
    }
  };

  const handleDelete = async (objectId: string) => {
    if (!scene) return;
    try {
      await removeSceneNpc(scene.sceneId, sessionId, objectId);
      setDeleteConfirm(null);
      onNpcDeleted();
    } catch (err) {
      console.error("[NpcDrawer] delete error:", err);
    }
  };

  const filteredModels = CHARACTER_MODELS.filter(
    (m) => !modelSearch || m.id.includes(modelSearch.toLowerCase()) || m.tags.some((t) => t.includes(modelSearch.toLowerCase())),
  );

  const drawerStyle: React.CSSProperties = {
    position: "fixed",
    right: 0,
    top: 0,
    bottom: 0,
    width: 340,
    transform: open ? "translateX(0)" : "translateX(100%)",
    transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)",
    zIndex: 110,
    background: "rgba(10,8,28,0.97)",
    backdropFilter: "blur(16px)",
    borderLeft: "1px solid rgba(140,100,255,0.22)",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "rgba(200,220,255,0.9)",
    overflowY: "auto",
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 18px 12px",
    borderBottom: "1px solid rgba(140,100,255,0.15)",
    flexShrink: 0,
  };

  return (
    <div style={drawerStyle}>
      {/* ── List view ── */}
      {view === "list" && (
        <>
          <div style={headerStyle}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>NPC 管理</span>
            <button onClick={onClose} style={{ ...BTN_GHOST, fontSize: 16, padding: "2px 8px" }}>×</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
            {npcs.length === 0 ? (
              <div style={{ textAlign: "center", color: "rgba(140,150,180,0.5)", fontSize: 13, marginTop: 32 }}>
                暂无 NPC
              </div>
            ) : (
              npcs.map((npc) => (
                <div key={npc.objectId} style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(140,100,255,0.15)",
                  borderRadius: 9, padding: "10px 12px", marginBottom: 8,
                }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{npc.name}</div>
                  <div style={{ fontSize: 12, color: "rgba(160,180,255,0.6)", marginBottom: 8, lineHeight: 1.4 }}>
                    {((npc.metadata.npcPersonality as string | undefined) ?? "").slice(0, 60)}
                    {((npc.metadata.npcPersonality as string | undefined) ?? "").length > 60 ? "…" : ""}
                  </div>
                  {deleteConfirm === npc.objectId ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "rgba(255,130,130,0.8)", flex: 1 }}>确认删除？</span>
                      <button onClick={() => handleDelete(npc.objectId)} style={{ ...BTN_DANGER, width: "auto", padding: "4px 10px" }}>删除</button>
                      <button onClick={() => setDeleteConfirm(null)} style={BTN_GHOST}>取消</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => openEdit(npc)} style={{ ...BTN_GHOST, flex: 1 }}>编辑</button>
                      <button onClick={() => setDeleteConfirm(npc.objectId)} style={BTN_DANGER}>删除</button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(140,100,255,0.15)", flexShrink: 0 }}>
            <button onClick={openAdd} style={BTN_PRIMARY}>+ 添加 NPC</button>
          </div>
        </>
      )}

      {/* ── Add view ── */}
      {view === "add" && (
        <>
          <div style={headerStyle}>
            <button onClick={backToList} style={{ ...BTN_GHOST, fontSize: 15, padding: "2px 8px" }}>←</button>
            <span style={{ fontSize: 15, fontWeight: 600 }}>添加 NPC</span>
            <div style={{ width: 32 }} />
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Name */}
            <div>
              <label style={LABEL_STYLE}>名字 *</label>
              <input value={addName} onChange={(e) => setAddName(e.target.value)}
                placeholder="例如：老王、张三" style={INPUT_STYLE} />
            </div>

            {/* Personality */}
            <div>
              <label style={LABEL_STYLE}>性格 *</label>
              <textarea value={addPersonality} onChange={(e) => setAddPersonality(e.target.value)}
                placeholder="例如：古老的守林人，说话简短，充满智慧" rows={3}
                style={{ ...INPUT_STYLE, resize: "vertical" }} />
            </div>

            {/* Traits */}
            <div>
              <label style={LABEL_STYLE}>特点 / 技能</label>
              <input value={addTraits} onChange={(e) => setAddTraits(e.target.value)}
                placeholder="例如：擅长烹饪、记忆力强、武艺高强" style={INPUT_STYLE} />
            </div>

            {/* Model source tabs */}
            <div>
              <label style={LABEL_STYLE}>3D 模型</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                {(["catalog", "url"] as ModelTab[]).map((tab) => (
                  <button key={tab} onClick={() => setModelTab(tab)} style={{
                    ...BTN_GHOST,
                    flex: 1,
                    borderColor: modelTab === tab ? "rgba(100,140,255,0.6)" : undefined,
                    color: modelTab === tab ? "rgba(200,220,255,0.95)" : undefined,
                    background: modelTab === tab ? "rgba(100,140,255,0.15)" : undefined,
                  }}>
                    {tab === "catalog" ? "资源库" : "URL"}
                  </button>
                ))}
              </div>

              {modelTab === "catalog" && (
                <>
                  <input value={modelSearch} onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="搜索模型..." style={{ ...INPUT_STYLE, marginBottom: 8 }} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                    {filteredModels.map((m) => (
                      <button key={m.id} onClick={() => setSelectedModel(m)} style={{
                        padding: "8px 4px",
                        background: selectedModel?.id === m.id ? "rgba(100,140,255,0.25)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${selectedModel?.id === m.id ? "rgba(100,140,255,0.6)" : "rgba(140,100,255,0.15)"}`,
                        borderRadius: 7, cursor: "pointer",
                        color: "rgba(200,220,255,0.85)", fontSize: 11,
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                      }}>
                        <span style={{ fontSize: 18 }}>
                          {m.tags.includes("soldier") ? "💂" : m.tags.includes("robot") ? "🤖" : "🧍"}
                        </span>
                        <span style={{ lineHeight: 1.2, wordBreak: "break-word" }}>
                          {m.id.replace("character_", "")}
                        </span>
                      </button>
                    ))}
                  </div>
                  {filteredModels.length === 0 && (
                    <div style={{ fontSize: 12, color: "rgba(140,150,180,0.5)", textAlign: "center", marginTop: 8 }}>
                      无匹配模型
                    </div>
                  )}
                </>
              )}

              {modelTab === "url" && (
                <input value={cdnUrl} onChange={(e) => setCdnUrl(e.target.value)}
                  placeholder="https://example.com/character.glb" style={INPUT_STYLE} />
              )}
            </div>

            {/* Placement hint */}
            <div style={{
              background: "rgba(60,100,255,0.1)", border: "1px solid rgba(60,100,255,0.25)",
              borderRadius: 8, padding: "8px 12px", fontSize: 12,
              color: "rgba(160,200,255,0.8)", lineHeight: 1.5,
            }}>
              按 <strong>F</strong> 键瞄准放置目标位置，再点击「确定放置」
            </div>

            {addError && (
              <div style={{ fontSize: 12, color: "rgba(255,130,130,0.9)", background: "rgba(255,60,60,0.08)", borderRadius: 6, padding: "6px 10px" }}>
                {addError}
              </div>
            )}
          </div>

          <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(140,100,255,0.15)", flexShrink: 0 }}>
            <button onClick={handleAdd} disabled={adding} style={{ ...BTN_PRIMARY, opacity: adding ? 0.6 : 1 }}>
              {adding ? "添加中..." : "确定放置"}
            </button>
          </div>
        </>
      )}

      {/* ── Edit view ── */}
      {view === "edit" && editTarget && (
        <>
          <div style={headerStyle}>
            <button onClick={backToList} style={{ ...BTN_GHOST, fontSize: 15, padding: "2px 8px" }}>←</button>
            <span style={{ fontSize: 15, fontWeight: 600 }}>编辑 NPC</span>
            <div style={{ width: 32 }} />
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={LABEL_STYLE}>名字 *</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} style={INPUT_STYLE} />
            </div>
            <div>
              <label style={LABEL_STYLE}>性格 *</label>
              <textarea value={editPersonality} onChange={(e) => setEditPersonality(e.target.value)}
                rows={4} style={{ ...INPUT_STYLE, resize: "vertical" }} />
            </div>
            <div>
              <label style={LABEL_STYLE}>特点 / 技能</label>
              <input value={editTraits} onChange={(e) => setEditTraits(e.target.value)}
                placeholder="擅长烹饪、记忆力强..." style={INPUT_STYLE} />
            </div>

            {editError && (
              <div style={{ fontSize: 12, color: "rgba(255,130,130,0.9)", background: "rgba(255,60,60,0.08)", borderRadius: 6, padding: "6px 10px" }}>
                {editError}
              </div>
            )}

            {/* ── Evolution log ── */}
            <div style={{ borderTop: "1px solid rgba(140,100,255,0.15)", paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "rgba(160,180,255,0.7)", fontWeight: 600 }}>性格进化记录</span>
                <span style={{ fontSize: 11, color: "rgba(120,140,180,0.5)" }}>
                  {evolutionLoading ? "加载中..." : `已对话 ${interactionCount} 次`}
                </span>
              </div>
              {!evolutionLoading && evolutionLog.length === 0 && (
                <div style={{ fontSize: 12, color: "rgba(120,140,180,0.4)", textAlign: "center", padding: "8px 0" }}>
                  暂无进化提案（每 20 次对话触发一次分析）
                </div>
              )}
              {evolutionLog.slice().reverse().map((entry) => (
                <div key={entry.id} style={{
                  background: entry.status === "pending" ? "rgba(100,140,255,0.08)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${entry.status === "pending" ? "rgba(100,140,255,0.3)" : "rgba(140,100,255,0.12)"}`,
                  borderRadius: 8, padding: "10px 12px", marginBottom: 8,
                }}>
                  <div style={{ fontSize: 11, color: "rgba(120,140,180,0.5)", marginBottom: 6 }}>
                    第 {entry.interactionCount} 次对话后 · {new Date(entry.triggeredAt).toLocaleDateString()}
                    {entry.status !== "pending" && (
                      <span style={{ marginLeft: 6, color: entry.status === "approved" ? "rgba(100,220,120,0.7)" : "rgba(220,100,100,0.7)" }}>
                        {entry.status === "approved" ? "已采纳" : "已拒绝"}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(200,215,255,0.85)", lineHeight: 1.5, marginBottom: entry.status === "pending" ? 8 : 0 }}>
                    {entry.suggestedDelta}
                  </div>
                  {entry.status === "pending" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => handleApproveEvolution(entry.id)}
                        disabled={evolutionActionId === entry.id}
                        style={{ ...BTN_GHOST, flex: 1, borderColor: "rgba(100,200,120,0.4)", color: "rgba(140,220,150,0.9)", fontSize: 12 }}
                      >
                        {evolutionActionId === entry.id ? "处理中..." : "采纳"}
                      </button>
                      <button
                        onClick={() => handleRejectEvolution(entry.id)}
                        disabled={evolutionActionId === entry.id}
                        style={{ ...BTN_DANGER, fontSize: 12 }}
                      >
                        拒绝
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(140,100,255,0.15)", flexShrink: 0 }}>
            <button onClick={handleSaveEdit} disabled={saving} style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }}>
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
