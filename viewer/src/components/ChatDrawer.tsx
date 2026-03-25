import { useState, useRef, useEffect, useCallback } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  isStreaming?: boolean;
}

export interface SceneCard {
  sceneId: string;
  title: string;
  viewUrl: string;
}

interface Props {
  messages: ChatMessage[];
  sceneCards: SceneCard[];
  isTyping: boolean;
  onSend: (text: string) => void;
  onSceneSelect: (card: SceneCard) => void;
}

type DrawerState = "peek" | "open";

const PEEK_HEIGHT = 72;
const OPEN_HEIGHT_VH = 52;

// Minimal markdown link rendering: [text](url) → <a>
function renderText(text: string): React.ReactNode {
  const parts = text.split(/(\[([^\]]+)\]\(([^)]+)\))/g);
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < parts.length) {
    if (parts[i].startsWith("[") && i + 2 < parts.length) {
      const label = parts[i + 1];
      const href = parts[i + 2];
      nodes.push(
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noreferrer"
          style={{ color: "#7eb8f7", textDecoration: "underline" }}
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </a>,
      );
      i += 3;
    } else {
      if (parts[i]) {
        nodes.push(<span key={i}>{parts[i]}</span>);
      }
      i++;
    }
  }
  return nodes;
}

export function ChatDrawer({ messages, sceneCards, isTyping, onSend, onSceneSelect }: Props) {
  const [state, setState] = useState<DrawerState>("peek");
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-open when a new message arrives
  useEffect(() => {
    if (messages.length > 0 && state === "peek") setState("open");
  }, [messages.length]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isTyping]);

  const toggleState = useCallback(() => {
    setState((s) => (s === "peek" ? "open" : "peek"));
  }, []);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onSend(text);
    setState("open");
    // Resize textarea back
    if (inputRef.current) inputRef.current.style.height = "40px";
  }, [draft, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    const el = e.target;
    el.style.height = "40px";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const isOpen = state === "open";
  const drawerHeight = isOpen ? `${OPEN_HEIGHT_VH}vh` : `${PEEK_HEIGHT}px`;
  const lastMsg = messages[messages.length - 1];

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: drawerHeight,
        transition: "height 0.3s cubic-bezier(0.4,0,0.2,1)",
        display: "flex",
        flexDirection: "column",
        background: "rgba(8,8,16,0.88)",
        backdropFilter: "blur(12px)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        zIndex: 100,
      }}
    >
      {/* Drag handle */}
      <div
        onClick={toggleState}
        style={{
          flexShrink: 0,
          height: PEEK_HEIGHT,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          cursor: "pointer",
          gap: 12,
          userSelect: "none",
        }}
      >
        {/* Handle bar */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 10,
            transform: "translateX(-50%)",
            width: 36,
            height: 4,
            borderRadius: 2,
            background: "rgba(255,255,255,0.2)",
          }}
        />

        {/* Chevron */}
        <svg
          width={18}
          height={18}
          viewBox="0 0 18 18"
          style={{
            flexShrink: 0,
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.3s",
            color: "rgba(255,255,255,0.45)",
          }}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <polyline points="4,6 9,11 14,6" />
        </svg>

        {/* Peek preview: show last message text or placeholder */}
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: lastMsg ? (lastMsg.role === "user" ? "#e0d8ff" : "#c8dff8") : "rgba(255,255,255,0.3)",
            fontSize: 14,
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          {lastMsg ? lastMsg.text : "描述一个你想探索的世界…"}
        </div>
      </div>

      {/* Message list — only visible when open */}
      {isOpen && (
        <>
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "0 16px 8px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {messages.length === 0 && (
              <div
                style={{
                  color: "rgba(255,255,255,0.25)",
                  fontSize: 14,
                  textAlign: "center",
                  marginTop: 24,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                }}
              >
                告诉我你想探索什么样的世界
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "82%",
                }}
              >
                <div
                  style={{
                    background:
                      msg.role === "user"
                        ? "rgba(110,80,220,0.45)"
                        : "rgba(255,255,255,0.07)",
                    borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    padding: "9px 13px",
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: msg.role === "user" ? "#e8e0ff" : "#d8eaff",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.isStreaming ? (
                    <>
                      {renderText(msg.text)}
                      <span
                        style={{
                          display: "inline-block",
                          width: 6,
                          height: 14,
                          background: "rgba(200,220,255,0.7)",
                          marginLeft: 2,
                          verticalAlign: "middle",
                          borderRadius: 1,
                          animation: "blink 0.9s step-end infinite",
                        }}
                      />
                    </>
                  ) : (
                    renderText(msg.text)
                  )}
                </div>
              </div>
            ))}

            {/* Scene cards */}
            {sceneCards.map((card) => (
              <div key={card.sceneId} style={{ alignSelf: "flex-start", maxWidth: "82%" }}>
                <div
                  style={{
                    background: "rgba(40,60,90,0.6)",
                    border: "1px solid rgba(100,160,255,0.25)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    setState("peek");
                    onSceneSelect(card);
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: "rgba(80,120,200,0.4)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="#7eb8f7" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 2L2 5v6l6 3 6-3V5L8 2z" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#c8e0ff", fontFamily: "system-ui, -apple-system, sans-serif" }}>
                      {card.title}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(150,190,255,0.6)", marginTop: 2, fontFamily: "system-ui, -apple-system, sans-serif" }}>
                      点击进入场景
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {isTyping && (
              <div style={{ alignSelf: "flex-start" }}>
                <div
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    borderRadius: "16px 16px 16px 4px",
                    padding: "9px 13px",
                    display: "flex",
                    gap: 5,
                    alignItems: "center",
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "rgba(180,200,255,0.6)",
                        animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Input row */}
          <div
            style={{
              flexShrink: 0,
              padding: "8px 12px 12px",
              display: "flex",
              gap: 8,
              alignItems: "flex-end",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <textarea
              ref={inputRef}
              value={draft}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="描述一个场景…"
              rows={1}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 12,
                padding: "10px 14px",
                color: "#e0e8ff",
                fontSize: 14,
                fontFamily: "system-ui, -apple-system, sans-serif",
                resize: "none",
                outline: "none",
                height: 40,
                minHeight: 40,
                maxHeight: 120,
                lineHeight: 1.4,
                overflowY: "auto",
              }}
            />
            <button
              onClick={handleSend}
              disabled={!draft.trim()}
              style={{
                flexShrink: 0,
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: "none",
                background: draft.trim() ? "rgba(100,80,220,0.8)" : "rgba(80,80,100,0.4)",
                cursor: draft.trim() ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.2s",
              }}
            >
              <svg width={18} height={18} viewBox="0 0 18 18" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="9" y1="14" x2="9" y2="4" />
                <polyline points="4,9 9,4 14,9" />
              </svg>
            </button>
          </div>
        </>
      )}

      {/* CSS animations via style tag */}
      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}
