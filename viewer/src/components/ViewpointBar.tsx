import type { Viewpoint } from "../types.js";

interface Props {
  viewpoints: Viewpoint[];
  onSelect: (viewpoint: Viewpoint) => void;
}

export function ViewpointBar({ viewpoints, onSelect }: Props) {
  if (viewpoints.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        justifyContent: "center",
        pointerEvents: "auto",
        zIndex: 10,
      }}
    >
      {viewpoints.map((vp) => (
        <button
          key={vp.viewpointId}
          onClick={() => onSelect(vp)}
          style={{
            background: "rgba(0,0,0,0.6)",
            color: "#f0e6cc",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 20,
            padding: "5px 14px",
            fontSize: 13,
            cursor: "pointer",
            backdropFilter: "blur(4px)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.2)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.6)";
          }}
        >
          {vp.name}
        </button>
      ))}
    </div>
  );
}
