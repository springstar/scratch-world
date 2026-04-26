import { useState, useRef, useEffect, useCallback } from "react";
import type { SceneListItem } from "../api.js";
import { uploadMedia } from "../api.js";
import type { UploadedMedia } from "../api.js";

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "command_result";
  text: string;
  images?: string[]; // data URLs for display
  isStreaming?: boolean;
  scenes?: SceneListItem[]; // populated when role === "command_result"
}

export interface SceneCard {
  sceneId: string;
  title: string;
  viewUrl: string;
}

// Image attachment pending send
interface PendingImage {
  dataUrl: string;   // for preview display
  base64: string;    // raw base64 (no prefix)
  mimeType: string;
}

interface Props {
  messages: ChatMessage[];
  sceneCards: SceneCard[];
  isTyping: boolean;
  onSend: (text: string, images?: PendingImage[], mediaFiles?: UploadedMedia[]) => void;
  onSceneSelect: (card: SceneCard) => void;
  onCommand: (cmd: string) => void;
  onDeleteScene: (sceneId: string) => void;
}

export type { PendingImage, UploadedMedia };

type DrawerState = "peek" | "open";

const PEEK_HEIGHT = 72;
const OPEN_HEIGHT_VH = 54;

const COMMANDS: Array<{ name: string; description: string }> = [
  { name: "/list", description: "列出所有已生成的场景" },
  { name: "/find", description: "按名称或描述模糊查找场景，如 /find 森林" },
];

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
          style={{ color: "#9dc8ff", textDecoration: "underline" }}
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

function relativeTime(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return "刚刚";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function ChatDrawer({ messages, sceneCards, isTyping, onSend, onSceneSelect, onCommand, onDeleteScene }: Props) {
  const [state, setState] = useState<DrawerState>("peek");
  const [draft, setDraft] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingMediaFiles, setPendingMediaFiles] = useState<UploadedMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastMsgRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-open when a new message arrives
  useEffect(() => {
    if (messages.length > 0 && state === "peek") setState("open");
  }, [messages.length]);

  // Auto-scroll: show top of command_result grids; otherwise scroll to bottom
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    if (last?.role === "command_result" && lastMsgRef.current) {
      lastMsgRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isTyping]);

  const toggleState = useCallback(() => {
    setState((s) => (s === "peek" ? "open" : "peek"));
  }, []);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (text.startsWith("/")) {
      setDraft("");
      if (inputRef.current) inputRef.current.style.height = "40px";
      onCommand(text);
      setState("open");
      return;
    }
    if (!text && pendingImages.length === 0 && pendingMediaFiles.length === 0) return;
    setDraft("");
    setPendingImages([]);
    setPendingMediaFiles([]);
    onSend(
      text,
      pendingImages.length > 0 ? pendingImages : undefined,
      pendingMediaFiles.length > 0 ? pendingMediaFiles : undefined,
    );
    setState("open");
    if (inputRef.current) inputRef.current.style.height = "40px";
  }, [draft, pendingImages, pendingMediaFiles, onSend, onCommand]);

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

  // Convert a File/Blob to PendingImage
  const fileToImage = useCallback(async (file: File): Promise<PendingImage | null> => {
    if (!file.type.startsWith("image/")) return null;
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        // dataUrl = "data:<mimeType>;base64,<base64>"
        const base64 = dataUrl.split(",")[1] ?? "";
        resolve({ dataUrl, base64, mimeType: file.type });
      };
      reader.readAsDataURL(file);
    });
  }, []);

  // Paste handler — capture pasted images
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const results = await Promise.all(
      imageItems.map((item) => {
        const file = item.getAsFile();
        return file ? fileToImage(file) : Promise.resolve(null);
      }),
    );
    const valid = results.filter((r): r is PendingImage => r !== null);
    if (valid.length > 0) setPendingImages((prev) => [...prev, ...valid]);
  }, [fileToImage]);

  // File input change handler — images as base64, videos pre-uploaded via /media-upload
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";

    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    const mediaFiles = files.filter((f) => f.type.startsWith("video/") || f.type.startsWith("image/"));

    // Base64 images for inline preview
    const imageResults = await Promise.all(imageFiles.map(fileToImage));
    const validImages = imageResults.filter((r): r is PendingImage => r !== null);
    if (validImages.length > 0) setPendingImages((prev) => [...prev, ...validImages]);

    // Pre-upload all files (images and videos) via /media-upload for Marble path
    const uploadables = mediaFiles;
    if (uploadables.length > 0) {
      setUploading(true);
      try {
        const uploaded = await Promise.all(uploadables.map((f) => uploadMedia(f)));
        setPendingMediaFiles((prev) => [...prev, ...uploaded]);
      } catch (err) {
        console.error("[ChatDrawer] media upload failed:", err);
      } finally {
        setUploading(false);
      }
    }
  }, [fileToImage]);

  const removeImage = useCallback((idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const removeMediaFile = useCallback((idx: number) => {
    setPendingMediaFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const isOpen = state === "open";
  const drawerHeight = isOpen ? `${OPEN_HEIGHT_VH}vh` : `${PEEK_HEIGHT}px`;
  const lastMsg = messages[messages.length - 1];
  const canSend = !!(draft.trim() || pendingImages.length > 0 || pendingMediaFiles.length > 0);

  // Command autocomplete: show only while typing the command word (no space yet)
  const cmdToken = draft.trim();
  const matchingCommands = isOpen && cmdToken.startsWith("/") && !cmdToken.includes(" ")
    ? COMMANDS.filter((c) => c.name.startsWith(cmdToken))
    : [];

  const dotColors = ["#a78bfa", "#818cf8", "#60a5fa"];

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: drawerHeight,
        transition: "height 0.32s cubic-bezier(0.4,0,0.2,1)",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(180deg, rgba(18,12,42,0.94) 0%, rgba(10,8,28,0.97) 100%)",
        backdropFilter: "blur(16px)",
        borderTop: "1px solid rgba(140,100,255,0.22)",
        boxShadow: "0 -4px 32px rgba(80,40,200,0.18), 0 -1px 0 rgba(140,100,255,0.12)",
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
            background: "linear-gradient(90deg, rgba(160,120,255,0.5) 0%, rgba(100,160,255,0.5) 100%)",
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
            transition: "transform 0.32s cubic-bezier(0.4,0,0.2,1)",
            color: "rgba(180,150,255,0.7)",
          }}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <polyline points="4,6 9,11 14,6" />
        </svg>

        {/* Peek preview */}
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: lastMsg
              ? lastMsg.role === "user"
                ? "rgba(220,200,255,0.9)"
                : "rgba(180,220,255,0.9)"
              : "rgba(160,140,210,0.45)",
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
                  color: "rgba(160,140,210,0.4)",
                  fontSize: 14,
                  textAlign: "center",
                  marginTop: 24,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                }}
              >
                告诉我你想探索什么样的世界
              </div>
            )}

            {messages.map((msg, idx) => {
              // command_result — render scene grid instead of a bubble
              if (msg.role === "command_result" && msg.scenes) {
                const isLast = idx === messages.length - 1;
                return (
                  <div key={msg.id} ref={isLast ? lastMsgRef : undefined} style={{ alignSelf: "stretch", animation: "msgIn 0.22s cubic-bezier(0.2,0,0,1) both" }}>
                    <div style={{ fontSize: 12, color: "rgba(140,120,200,0.55)", fontFamily: "monospace", marginBottom: 6 }}>
                      {msg.text}
                    </div>
                    {msg.scenes.length === 0 ? (
                      <div style={{ color: "rgba(160,140,210,0.5)", fontSize: 13, fontFamily: "system-ui, -apple-system, sans-serif" }}>
                        还没有场景
                      </div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {msg.scenes.map((scene) => (
                          <div
                            key={scene.sceneId}
                            style={{
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(140,100,255,0.18)",
                              borderRadius: 10,
                              overflow: "hidden",
                              cursor: "pointer",
                              transition: "border-color 0.18s, background 0.18s",
                              position: "relative",
                            }}
                          >
                            {/* Delete button */}
                            <button
                              onClick={(e) => { e.stopPropagation(); onDeleteScene(scene.sceneId); }}
                              title="删除场景"
                              style={{
                                position: "absolute",
                                top: 4,
                                left: 4,
                                zIndex: 2,
                                width: 22,
                                height: 22,
                                borderRadius: "50%",
                                border: "none",
                                background: "rgba(20,10,40,0.75)",
                                color: "rgba(220,160,160,0.85)",
                                fontSize: 14,
                                lineHeight: 1,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: 0,
                                backdropFilter: "blur(4px)",
                              }}
                            >
                              ×
                            </button>
                            {/* Clickable area */}
                            <div onClick={() => { setState("peek"); onSceneSelect({ sceneId: scene.sceneId, title: scene.title, viewUrl: "" }); }}>
                            {/* Thumbnail */}
                            <div style={{ width: "100%", aspectRatio: "16/9", background: "linear-gradient(135deg, rgba(40,30,80,0.8) 0%, rgba(20,40,90,0.8) 100%)", position: "relative", overflow: "hidden" }}>
                              {scene.thumbnailUrl ? (
                                <img
                                  src={scene.thumbnailUrl}
                                  alt={scene.title}
                                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                />
                              ) : (
                                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <svg width={20} height={20} viewBox="0 0 16 16" fill="none" stroke="rgba(120,160,255,0.4)" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M8 2L2 5v6l6 3 6-3V5L8 2z" />
                                  </svg>
                                </div>
                              )}
                              {/* Status badge */}
                              {scene.status === "generating" && (
                                <div style={{ position: "absolute", top: 4, right: 4, width: 7, height: 7, borderRadius: "50%", background: "#f59e0b", boxShadow: "0 0 5px #f59e0b" }} />
                              )}
                              {scene.status === "failed" && (
                                <div style={{ position: "absolute", top: 4, right: 4, width: 7, height: 7, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 5px #ef4444" }} />
                              )}
                            </div>
                            {/* Meta */}
                            <div style={{ padding: "6px 8px" }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "#c8d8ff", fontFamily: "system-ui, -apple-system, sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {scene.title}
                              </div>
                              <div style={{ fontSize: 10, color: "rgba(140,160,220,0.5)", marginTop: 2, fontFamily: "system-ui, -apple-system, sans-serif" }}>
                                {relativeTime(scene.createdAt)}
                              </div>
                            </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div
                  key={msg.id}
                  style={{
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "82%",
                    animation: "msgIn 0.22s cubic-bezier(0.2,0,0,1) both",
                  }}
                >
                  {/* Image thumbnails (user messages) */}
                  {msg.images && msg.images.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4, justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                      {msg.images.map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt=""
                          style={{ maxWidth: 140, maxHeight: 100, borderRadius: 8, objectFit: "cover", border: "1px solid rgba(140,100,255,0.3)" }}
                        />
                      ))}
                    </div>
                  )}
                  <div
                    style={{
                      background:
                        msg.role === "user"
                          ? "linear-gradient(135deg, rgba(130,80,240,0.7) 0%, rgba(80,100,230,0.65) 100%)"
                          : "rgba(255,255,255,0.065)",
                      borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                      padding: "9px 13px",
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: msg.role === "user" ? "rgba(238,228,255,0.97)" : "rgba(210,230,255,0.92)",
                      fontFamily: "system-ui, -apple-system, sans-serif",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      border: msg.role === "agent" ? "1px solid rgba(140,120,220,0.12)" : "none",
                      boxShadow:
                        msg.role === "user"
                          ? "0 2px 16px rgba(100,60,220,0.3)"
                          : "none",
                      display: msg.text ? undefined : "none",
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
                            background: "rgba(180,210,255,0.8)",
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
              );
            })}

            {/* Scene cards */}
            {sceneCards.map((card) => (
              <div key={card.sceneId} style={{ alignSelf: "flex-start", maxWidth: "82%", animation: "msgIn 0.25s cubic-bezier(0.2,0,0,1) both" }}>
                <div
                  style={{
                    background: "linear-gradient(135deg, rgba(30,50,100,0.55) 0%, rgba(20,35,80,0.6) 100%)",
                    border: "1px solid rgba(100,160,255,0.28)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    boxShadow: "0 2px 20px rgba(40,100,255,0.12)",
                    transition: "border-color 0.2s, box-shadow 0.2s",
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
                      background: "linear-gradient(135deg, rgba(60,100,220,0.5) 0%, rgba(80,60,200,0.5) 100%)",
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
                    <div style={{ fontSize: 11, color: "rgba(140,190,255,0.6)", marginTop: 2, fontFamily: "system-ui, -apple-system, sans-serif" }}>
                      点击进入场景
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {isTyping && (
              <div style={{ alignSelf: "flex-start", animation: "msgIn 0.2s cubic-bezier(0.2,0,0,1) both" }}>
                <div
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(140,120,220,0.12)",
                    borderRadius: "16px 16px 16px 4px",
                    padding: "9px 14px",
                    display: "flex",
                    gap: 5,
                    alignItems: "center",
                  }}
                >
                  {dotColors.map((color, i) => (
                    <div
                      key={i}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: color,
                        animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                        boxShadow: `0 0 6px ${color}`,
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
              flexDirection: "column",
              gap: 6,
              borderTop: "1px solid rgba(120,90,200,0.12)",
              position: "relative",
            }}
          >
            {/* Command autocomplete */}
            {matchingCommands.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  bottom: "100%",
                  left: 12,
                  right: 12,
                  background: "rgba(18,12,42,0.97)",
                  border: "1px solid rgba(140,100,255,0.28)",
                  borderRadius: 10,
                  overflow: "hidden",
                  boxShadow: "0 -4px 20px rgba(80,40,200,0.25)",
                  zIndex: 10,
                }}
              >
                {matchingCommands.map((cmd) => (
                  <div
                    key={cmd.name}
                    onClick={() => {
                      setDraft(cmd.name);
                      inputRef.current?.focus();
                    }}
                    style={{
                      padding: "8px 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      cursor: "pointer",
                      borderBottom: "1px solid rgba(140,100,255,0.1)",
                    }}
                  >
                    <span style={{ fontFamily: "monospace", fontSize: 13, color: "#b8a0ff", fontWeight: 600 }}>
                      {cmd.name}
                    </span>
                    <span style={{ fontSize: 12, color: "rgba(160,150,220,0.55)", fontFamily: "system-ui, -apple-system, sans-serif" }}>
                      {cmd.description}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Pending image previews */}
            {pendingImages.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "2px 0" }}>
                {pendingImages.map((img, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img
                      src={img.dataUrl}
                      alt=""
                      style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", border: "1px solid rgba(140,100,255,0.35)", display: "block" }}
                    />
                    <button
                      onClick={() => removeImage(i)}
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -6,
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "rgba(30,20,50,0.9)",
                        border: "1px solid rgba(180,140,255,0.4)",
                        color: "rgba(220,200,255,0.9)",
                        fontSize: 11,
                        lineHeight: 1,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Pending media file chips (uploaded videos/images) */}
            {(pendingMediaFiles.length > 0 || uploading) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "2px 0" }}>
                {uploading && (
                  <div style={{ fontSize: 11, color: "rgba(180,160,255,0.7)", alignSelf: "center", padding: "0 4px" }}>
                    上传中…
                  </div>
                )}
                {pendingMediaFiles.map((mf, i) => {
                  const name = mf.publicUrl.split("/").pop() ?? mf.mimeType;
                  const isVideo = mf.kind === "video";
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "3px 8px",
                        borderRadius: 8,
                        background: "rgba(140,100,255,0.12)",
                        border: "1px solid rgba(140,100,255,0.3)",
                        fontSize: 11,
                        color: "rgba(200,180,255,0.9)",
                        maxWidth: 160,
                        position: "relative",
                      }}
                    >
                      <span style={{ marginRight: 2 }}>{isVideo ? "▶" : "🖼"}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                      <button
                        onClick={() => removeMediaFile(i)}
                        style={{
                          marginLeft: 4,
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: "rgba(30,20,50,0.9)",
                          border: "none",
                          color: "rgba(220,200,255,0.9)",
                          fontSize: 10,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 0,
                          flexShrink: 0,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                style={{ display: "none" }}
                onChange={handleFileChange}
              />

              {/* Upload button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                title="上传图片"
                style={{
                  flexShrink: 0,
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  border: "1px solid rgba(140,100,255,0.25)",
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(180,150,255,0.75)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.2s, border-color 0.2s",
                }}
              >
                {/* Paperclip icon */}
                <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>

              <textarea
                ref={inputRef}
                value={draft}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="描述一个场景，或输入 / 查看命令…"
                rows={1}
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,0.055)",
                  border: inputFocused
                    ? "1px solid rgba(140,100,255,0.55)"
                    : "1px solid rgba(140,100,255,0.14)",
                  borderRadius: 12,
                  padding: "10px 14px",
                  color: "#e8e0ff",
                  fontSize: 14,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  resize: "none",
                  outline: "none",
                  height: 40,
                  minHeight: 40,
                  maxHeight: 120,
                  lineHeight: 1.4,
                  overflowY: "auto",
                  boxShadow: inputFocused ? "0 0 0 3px rgba(120,80,240,0.18)" : "none",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                }}
              />
              <button
                onClick={handleSend}
                disabled={!canSend}
                style={{
                  flexShrink: 0,
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  border: "none",
                  background: canSend
                    ? "linear-gradient(135deg, #7c4dff 0%, #448aff 100%)"
                    : "rgba(80,70,110,0.35)",
                  cursor: canSend ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: canSend ? "0 2px 16px rgba(100,60,240,0.45), 0 0 0 1px rgba(140,100,255,0.3)" : "none",
                  transition: "background 0.2s, box-shadow 0.2s",
                }}
              >
                <svg width={18} height={18} viewBox="0 0 18 18" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="9" y1="14" x2="9" y2="4" />
                  <polyline points="4,9 9,4 14,9" />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-5px); }
        }
        @keyframes msgIn {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
