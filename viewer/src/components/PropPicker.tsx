import { useState, useEffect } from "react";
import type { AssetEntry, AssetType } from "../renderer/asset-catalog.js";
import { ASSET_CATALOG } from "../renderer/asset-catalog.js";

interface Props {
  visible: boolean;
  onSelect: (entry: AssetEntry) => void;
  onClose: () => void;
}

const TYPE_EMOJI: Record<AssetType, string> = {
  prop: "📦",
  animal: "🐾",
  character: "🧍",
  vehicle: "🚗",
  furniture: "🪑",
  nature: "🌿",
  building: "🏛",
  tree: "🌲",
  bush: "🌿",
  rock: "🪨",
};

const FILTER_TABS: Array<{ label: string; value: AssetType | "all" }> = [
  { label: "All", value: "all" },
  { label: "Props", value: "prop" },
  { label: "Animals", value: "animal" },
  { label: "Characters", value: "character" },
  { label: "Vehicles", value: "vehicle" },
  { label: "Furniture", value: "furniture" },
  { label: "Nature", value: "nature" },
];

function formatId(id: string): string {
  return id.replace(/^[a-z]+_/, "").replace(/_/g, " ");
}

export function PropPicker({ visible, onSelect, onClose }: Props) {
  const [activeType, setActiveType] = useState<AssetType | "all">("all");
  const [search, setSearch] = useState("");

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  if (!visible) return null;

  const filtered = ASSET_CATALOG.filter((e) => {
    if (activeType !== "all" && e.type !== activeType) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return e.id.includes(q) || e.tags.some((t) => t.includes(q));
    }
    return true;
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(6px)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "rgba(12,14,26,0.97)",
          border: "1px solid rgba(120,140,255,0.2)",
          borderRadius: 12,
          width: "min(680px, 92vw)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ color: "rgba(200,210,255,0.9)", fontSize: 14, fontFamily: "system-ui", fontWeight: 600, letterSpacing: 0.3 }}>
              Place Prop
            </span>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", color: "rgba(200,210,255,0.5)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}
            >
              ×
            </button>
          </div>
          {/* Search */}
          <input
            autoFocus
            placeholder="Search assets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color: "rgba(220,230,255,0.9)",
              fontSize: 13,
              padding: "7px 10px",
              outline: "none",
              fontFamily: "system-ui",
            }}
          />
        </div>

        {/* Filter tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "8px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            overflowX: "auto",
            flexShrink: 0,
          }}
        >
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveType(tab.value)}
              style={{
                background: activeType === tab.value ? "rgba(100,120,255,0.3)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${activeType === tab.value ? "rgba(100,120,255,0.6)" : "rgba(255,255,255,0.1)"}`,
                borderRadius: 4,
                color: activeType === tab.value ? "rgba(180,200,255,1)" : "rgba(180,190,220,0.6)",
                cursor: "pointer",
                fontSize: 12,
                padding: "4px 10px",
                whiteSpace: "nowrap",
                fontFamily: "system-ui",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
            padding: 14,
            overflowY: "auto",
          }}
        >
          {filtered.length === 0 && (
            <div style={{ gridColumn: "1/-1", color: "rgba(180,190,220,0.4)", fontSize: 13, textAlign: "center", padding: "24px 0", fontFamily: "system-ui" }}>
              No assets found
            </div>
          )}
          {filtered.map((entry) => (
            <button
              key={entry.id}
              onClick={() => onSelect(entry)}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                color: "rgba(210,220,255,0.9)",
                cursor: "pointer",
                padding: "10px 8px",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                transition: "background 0.12s",
                fontFamily: "system-ui",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(100,120,255,0.15)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)"; }}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }}>{TYPE_EMOJI[entry.type] ?? "📦"}</span>
              <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{formatId(entry.id)}</span>
              <span
                style={{
                  fontSize: 10,
                  color: "rgba(150,170,220,0.6)",
                  background: "rgba(100,120,255,0.15)",
                  borderRadius: 3,
                  padding: "1px 5px",
                  alignSelf: "flex-start",
                }}
              >
                {entry.type}
              </span>
              {entry.animated && (
                <span style={{ fontSize: 9, color: "rgba(140,220,140,0.7)" }}>animated</span>
              )}
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div style={{ padding: "8px 18px", borderTop: "1px solid rgba(255,255,255,0.07)", color: "rgba(150,160,200,0.5)", fontSize: 11, fontFamily: "system-ui" }}>
          Click to spawn · G to re-spawn last · ESC to close
        </div>
      </div>
    </div>
  );
}
