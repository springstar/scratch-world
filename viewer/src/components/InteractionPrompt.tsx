interface Props {
  objectName: string;
  interactionHint?: string;
  onAction: (action: string) => void;
  onDismiss: () => void;
}

const QUICK_ACTIONS = ["examine", "interact", "pick up", "open"];

export function InteractionPrompt({ objectName, interactionHint, onAction, onDismiss }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        background: "rgba(0,0,0,0.8)",
        color: "#f0e6cc",
        borderRadius: 12,
        padding: "18px 22px",
        minWidth: 260,
        fontFamily: "Georgia, serif",
        backdropFilter: "blur(6px)",
        boxShadow: "0 4px 32px rgba(0,0,0,0.6)",
        zIndex: 10,
      }}
    >
      <div style={{ fontWeight: "bold", marginBottom: 6, fontSize: 16 }}>{objectName}</div>
      {interactionHint && (
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>{interactionHint}</div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action}
            onClick={() => onAction(action)}
            style={{
              background: "rgba(255,255,255,0.12)",
              color: "#f0e6cc",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: 16,
              padding: "4px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {action}
          </button>
        ))}
      </div>
      <button
        onClick={onDismiss}
        style={{
          background: "transparent",
          color: "rgba(240,230,204,0.5)",
          border: "none",
          fontSize: 12,
          cursor: "pointer",
          padding: 0,
        }}
      >
        dismiss
      </button>
    </div>
  );
}
