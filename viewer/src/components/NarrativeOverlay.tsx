interface Props {
  lines: string[];
  isStreaming: boolean;
}

export function NarrativeOverlay({ lines, isStreaming }: Props) {
  if (lines.length === 0 && !isStreaming) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(600px, 90vw)",
        background: "rgba(0,0,0,0.72)",
        color: "#f0e6cc",
        borderRadius: 12,
        padding: "14px 18px",
        fontFamily: "Georgia, serif",
        fontSize: 15,
        lineHeight: 1.6,
        backdropFilter: "blur(4px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        pointerEvents: "none",
      }}
    >
      {lines.map((line, i) => (
        <p key={i} style={{ margin: "4px 0" }}>
          {line}
        </p>
      ))}
      {isStreaming && (
        <span style={{ opacity: 0.6, fontSize: 12 }}>▌</span>
      )}
    </div>
  );
}
