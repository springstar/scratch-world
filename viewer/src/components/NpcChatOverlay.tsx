import { useEffect, useRef, useState } from "react";

export interface NpcChatMessage {
  role: "user" | "npc";
  text: string;
}

interface Props {
  npcName: string;
  history: NpcChatMessage[];
  pending: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
}

export function NpcChatOverlay({ npcName, history, pending, onSend, onClose }: Props) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-focus input on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  // Scroll to bottom when history or pending changes
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [history, pending]);

  // Escape closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [onClose]);

  const submit = () => {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    onSend(text);
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        width: 380,
        maxWidth: "calc(100vw - 32px)",
        background: "rgba(8,6,20,0.94)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(120,100,255,0.28)",
        borderRadius: 14,
        boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
        display: "flex",
        flexDirection: "column",
        zIndex: 120,
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflow: "hidden",
      }}
      // Stop pointer events from falling through to the canvas
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px 8px",
        borderBottom: "1px solid rgba(120,100,255,0.18)",
      }}>
        <span style={{ fontSize: 13, color: "rgba(180,160,255,0.9)", fontWeight: 600, letterSpacing: 0.3 }}>
          {npcName}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "rgba(160,160,200,0.6)", fontSize: 16, lineHeight: 1,
            padding: "0 2px",
          }}
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        style={{
          display: "flex", flexDirection: "column", gap: 8,
          padding: "10px 12px",
          maxHeight: 220, overflowY: "auto",
          minHeight: history.length === 0 && !pending ? 40 : undefined,
        }}
      >
        {history.length === 0 && !pending && (
          <div style={{ fontSize: 12, color: "rgba(160,160,200,0.45)", textAlign: "center", paddingTop: 4 }}>
            输入消息开始对话
          </div>
        )}
        {history.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "82%",
              background: msg.role === "user"
                ? "rgba(100,80,220,0.35)"
                : "rgba(40,40,80,0.6)",
              border: `1px solid ${msg.role === "user" ? "rgba(120,100,255,0.3)" : "rgba(80,80,140,0.3)"}`,
              borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
              padding: "7px 11px",
              fontSize: 13,
              color: "rgba(210,220,255,0.92)",
              lineHeight: 1.55,
              wordBreak: "break-word",
            }}
          >
            {msg.text}
          </div>
        ))}
        {pending && (
          <div style={{
            alignSelf: "flex-start",
            background: "rgba(40,40,80,0.6)",
            border: "1px solid rgba(80,80,140,0.3)",
            borderRadius: "12px 12px 12px 4px",
            padding: "8px 14px",
            fontSize: 13,
            color: "rgba(160,160,220,0.7)",
          }}>
            <span style={{ animation: "npcBlink 1.2s infinite", display: "inline-block" }}>···</span>
          </div>
        )}
      </div>

      {/* Input row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px 10px",
        borderTop: "1px solid rgba(120,100,255,0.14)",
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation(); // prevent WASD / E etc. from reaching the game
            if (e.key === "Enter") { e.preventDefault(); submit(); }
          }}
          placeholder="输入消息…"
          disabled={pending}
          style={{
            flex: 1,
            background: "rgba(30,25,60,0.7)",
            border: "1px solid rgba(120,100,255,0.28)",
            borderRadius: 8,
            padding: "7px 11px",
            fontSize: 13,
            color: "rgba(210,220,255,0.92)",
            outline: "none",
            caretColor: "rgba(140,120,255,0.9)",
          }}
        />
        <button
          onClick={submit}
          disabled={!input.trim() || pending}
          style={{
            background: input.trim() && !pending ? "rgba(100,80,220,0.6)" : "rgba(60,50,100,0.4)",
            border: "1px solid rgba(120,100,255,0.3)",
            borderRadius: 8,
            padding: "7px 14px",
            fontSize: 13,
            color: input.trim() && !pending ? "rgba(210,220,255,0.95)" : "rgba(140,140,180,0.5)",
            cursor: input.trim() && !pending ? "pointer" : "default",
            flexShrink: 0,
          }}
        >
          发送
        </button>
      </div>

      {/* Blink keyframe */}
      <style>{`
        @keyframes npcBlink {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
