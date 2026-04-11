import type { DisplayConfig } from "../types.js";

interface Props {
  display: DisplayConfig;
  onClose: () => void;
}

function renderMarkdown(content: string): string {
  return content
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br />");
}

export function BehaviorOverlay({ display, onClose }: Props) {
  const title = display.title ?? "";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(6px)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "rgba(8,6,20,0.97)",
          border: "1px solid rgba(120,80,255,0.3)",
          borderRadius: 12,
          width: display.type === "table" ? "min(92vw, 860px)" : "min(90vw, 760px)",
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px 12px",
            borderBottom: "1px solid rgba(120,80,255,0.15)",
            flexShrink: 0,
          }}
        >
          <span style={{ color: "rgba(200,185,255,0.95)", fontSize: 15, fontWeight: 600 }}>
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "rgba(160,140,220,0.7)",
              fontSize: 20,
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {display.type === "iframe" && (
            <iframe
              src={display.url}
              style={{ width: "100%", height: "60vh", border: "none", display: "block" }}
              allow="autoplay; fullscreen"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          )}

          {display.type === "video" && (
            <video
              src={display.url}
              controls
              autoPlay
              style={{ width: "100%", maxHeight: "60vh", display: "block", background: "#000" }}
            />
          )}

          {display.type === "markdown" && (
            <div
              style={{
                padding: "20px 22px",
                color: "rgba(210,200,255,0.9)",
                fontSize: 14,
                lineHeight: 1.7,
              }}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: renderMarkdown(display.content) }}
            />
          )}

          {display.type === "table" && (
            <div style={{ padding: "4px 0 12px" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                  color: "rgba(210,200,255,0.88)",
                }}
              >
                <thead>
                  <tr>
                    {display.headers.map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "10px 14px",
                          textAlign: "left",
                          borderBottom: "1px solid rgba(120,80,255,0.25)",
                          color: "rgba(170,150,240,0.85)",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {display.rows.map((row, ri) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: row index is stable
                    <tr key={ri} style={{ background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.025)" }}>
                      {row.map((cell, ci) => {
                        const isChange = display.headers[ci] === "涨跌" || display.headers[ci] === "涨跌幅";
                        const isNeg = isChange && cell.startsWith("-");
                        const isPos = isChange && cell.startsWith("+");
                        return (
                          // biome-ignore lint/suspicious/noArrayIndexKey: col index is stable
                          <td
                            key={ci}
                            style={{
                              padding: "9px 14px",
                              borderBottom: "1px solid rgba(255,255,255,0.04)",
                              whiteSpace: "nowrap",
                              color: isNeg
                                ? "rgba(80,220,120,0.9)"
                                : isPos
                                  ? "rgba(255,100,100,0.9)"
                                  : undefined,
                            }}
                          >
                            {cell}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
