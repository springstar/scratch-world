import { useEffect, useRef, useState } from "react";

interface BoardMessage {
  text: string;
  timestamp: number;
}

interface Props {
  sceneId: string;
  objectId: string;
  objectName: string;
  onClose: () => void;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export function BulletinBoard({ sceneId, objectId, objectName, onClose }: Props) {
  const [messages, setMessages] = useState<BoardMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/scenes/${sceneId}/objects/${objectId}/messages`)
      .then((r) => r.json())
      .then((data: { messages?: BoardMessage[] }) => {
        if (data.messages) setMessages(data.messages);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [sceneId, objectId]);

  function handlePost(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    setError(null);
    fetch(`/scenes/${sceneId}/objects/${objectId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then((r) => r.json())
      .then((data: { messages?: BoardMessage[]; error?: string }) => {
        if (data.error) { setError(data.error); return; }
        if (data.messages) setMessages(data.messages);
        setDraft("");
      })
      .catch(() => setError("发送失败，请稍后再试"))
      .finally(() => setPosting(false));
  }

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 320,
        maxHeight: 480,
        background: "rgba(14, 10, 30, 0.94)",
        border: "1px solid rgba(180, 140, 80, 0.4)",
        borderRadius: 10,
        backdropFilter: "blur(14px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 60,
        boxShadow: "0 6px 40px rgba(0,0,0,0.6)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid rgba(180, 140, 80, 0.2)",
          flexShrink: 0,
        }}
      >
        <div style={{ color: "rgba(220, 180, 100, 0.95)", fontSize: 13, fontWeight: 600, letterSpacing: 0.4 }}>
          ✦ {objectName}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "rgba(180, 150, 100, 0.6)",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: "0 2px",
          }}
        >
          ×
        </button>
      </div>

      {/* Message list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {loading ? (
          <div style={{ color: "rgba(180, 150, 100, 0.4)", fontSize: 12, textAlign: "center", padding: "20px 0" }}>
            加载中…
          </div>
        ) : messages.length === 0 ? (
          <div style={{ color: "rgba(180, 150, 100, 0.35)", fontSize: 12, textAlign: "center", padding: "20px 14px", lineHeight: 1.7 }}>
            布告栏空空如也。<br />留下你到访的印记吧。
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.timestamp}-${i}`}
              style={{
                padding: "7px 14px",
                borderBottom: "1px solid rgba(120, 90, 40, 0.12)",
              }}
            >
              <div style={{ fontSize: 13, color: "rgba(220, 200, 160, 0.9)", lineHeight: 1.5 }}>{m.text}</div>
              <div style={{ fontSize: 10, color: "rgba(150, 120, 70, 0.5)", marginTop: 3 }}>{timeAgo(m.timestamp)}</div>
            </div>
          ))
        )}
      </div>

      {/* Post form */}
      <form
        onSubmit={handlePost}
        style={{
          borderTop: "1px solid rgba(180, 140, 80, 0.2)",
          padding: "10px 12px",
          flexShrink: 0,
          display: "flex",
          gap: 8,
          flexDirection: "column",
        }}
      >
        {error && (
          <div style={{ fontSize: 11, color: "rgba(255, 140, 100, 0.8)" }}>{error}</div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 50))}
            placeholder="留下一句话… (最多50字)"
            disabled={posting}
            style={{
              flex: 1,
              padding: "7px 10px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(180, 140, 80, 0.28)",
              borderRadius: 7,
              color: "rgba(220, 200, 160, 0.95)",
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={posting || !draft.trim()}
            style={{
              padding: "7px 14px",
              background: draft.trim() ? "rgba(180, 140, 60, 0.3)" : "rgba(100,100,100,0.15)",
              border: `1px solid ${draft.trim() ? "rgba(180, 140, 60, 0.5)" : "rgba(100,100,100,0.2)"}`,
              borderRadius: 7,
              color: draft.trim() ? "rgba(220, 190, 120, 0.95)" : "rgba(150,150,150,0.4)",
              fontSize: 13,
              cursor: draft.trim() ? "pointer" : "default",
              whiteSpace: "nowrap",
            }}
          >
            {posting ? "…" : "留言"}
          </button>
        </div>
        <div style={{ fontSize: 10, color: "rgba(150, 120, 70, 0.4)", textAlign: "right" }}>
          {draft.length}/50
        </div>
      </form>
    </div>
  );
}
