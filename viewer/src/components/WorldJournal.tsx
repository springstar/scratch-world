import { useEffect, useRef, useState } from "react";

export interface WorldEventEntry {
  eventId: string;
  worldTime: number;
  eventType: string;
  headline: string;
  body: string;
}

interface Props {
  sceneId: string;
  isOpen: boolean;
  onClose: () => void;
  onNewEvent?: (e: WorldEventEntry) => void;
}

function worldTimeToLabel(t: number): string {
  const h = Math.floor(t / 3600) % 24;
  const m = Math.floor((t % 3600) / 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

const EVENT_ICONS: Record<string, string> = {
  weather: "☁",
  discovery: "✦",
  npc_activity: "◈",
  anomaly: "◉",
};

export function WorldJournal({ sceneId, isOpen, onClose, onNewEvent }: Props) {
  const [events, setEvents] = useState<WorldEventEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Load history on open
  useEffect(() => {
    if (!isOpen || !sceneId) return;
    setLoading(true);
    fetch(`/scenes/${sceneId}/events?limit=20`)
      .then((r) => r.json())
      .then((data: { events?: WorldEventEntry[] }) => {
        if (data.events) setEvents(data.events);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, sceneId]);

  // Register __addWorldEvent callback so App.tsx can push incoming events
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__addWorldEvent = (e: WorldEventEntry) => {
      setEvents((prev) => [e, ...prev].slice(0, 50));
      onNewEvent?.(e);
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__addWorldEvent;
    };
  }, [onNewEvent]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 64,
        right: 12,
        width: 300,
        maxHeight: 420,
        background: "rgba(12, 10, 28, 0.92)",
        border: "1px solid rgba(120, 80, 200, 0.3)",
        borderRadius: 10,
        backdropFilter: "blur(12px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 50,
        boxShadow: "0 4px 32px rgba(0,0,0,0.5)",
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
          borderBottom: "1px solid rgba(120, 80, 200, 0.2)",
          flexShrink: 0,
        }}
      >
        <div style={{ color: "rgba(180, 150, 240, 0.9)", fontSize: 13, fontWeight: 600, letterSpacing: 0.5 }}>
          世界日志
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "rgba(150, 130, 200, 0.6)",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: "0 2px",
          }}
        >
          ×
        </button>
      </div>

      {/* Event list */}
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {loading ? (
          <div style={{ color: "rgba(150, 130, 200, 0.5)", fontSize: 12, textAlign: "center", padding: "20px 0" }}>
            加载中…
          </div>
        ) : events.length === 0 ? (
          <div style={{ color: "rgba(150, 130, 200, 0.4)", fontSize: 12, textAlign: "center", padding: "20px 14px" }}>
            世界尚无记录。开启 livingEnabled 后，世界将自动演化。
          </div>
        ) : (
          events.map((e) => (
            <EventRow key={e.eventId} event={e} />
          ))
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: WorldEventEntry }) {
  const [expanded, setExpanded] = useState(false);
  const icon = EVENT_ICONS[event.eventType] ?? "◈";

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      style={{
        display: "block",
        width: "100%",
        background: "none",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        padding: "7px 14px",
        borderBottom: "1px solid rgba(80, 60, 140, 0.15)",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(100, 70, 180, 0.12)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 13, color: "rgba(160, 120, 240, 0.7)" }}>{icon}</span>
        <span style={{ fontSize: 11, color: "rgba(120, 100, 180, 0.6)", fontFamily: "monospace" }}>
          {worldTimeToLabel(event.worldTime)}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 12,
            color: "rgba(200, 180, 255, 0.85)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {event.headline}
        </span>
      </div>
      {expanded && (
        <div
          style={{
            marginTop: 5,
            fontSize: 11,
            color: "rgba(160, 140, 210, 0.65)",
            lineHeight: 1.5,
            paddingLeft: 19,
          }}
        >
          {event.body}
        </div>
      )}
    </button>
  );
}
