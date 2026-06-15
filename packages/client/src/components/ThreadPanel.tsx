import { useState, useRef, useEffect } from "react";
import { useThreadStore } from "../stores/useThreadStore";
import { MessageItem } from "./MessageItem";

export function ThreadPanel() {
  const activeThread = useThreadStore((s) => s.activeThread);
  const messages = useThreadStore((s) => s.threadMessages);
  const loading = useThreadStore((s) => s.threadMessagesLoading);
  const closeThread = useThreadStore((s) => s.closeThread);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (!activeThread) return null;

  const displayName = activeThread.name.length > 40
    ? activeThread.name.slice(0, 40) + "\u2026"
    : activeThread.name;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {/* Header - matches Discord thread panel header */}
      <div style={{
        display: "flex", alignItems: "center", gap: "var(--space-sm)",
        padding: "0 var(--space-md)",
        height: "var(--header-height)",
        borderBottom: "1px solid var(--border-subtle)",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: "var(--font-size-lg)", color: "var(--text-muted)" }}>#</span>
        <span style={{
          flex: 1, fontWeight: 600, fontSize: "var(--font-size-lg)",
          color: "var(--header-primary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{displayName}</span>
        <button onClick={closeThread} style={{
          background: "none", border: "none", color: "var(--text-muted)",
          fontSize: "var(--font-size-xl)", cursor: "pointer", padding: "var(--space-xs)",
          lineHeight: 1,
        }}>&#10005;</button>
      </div>

      {/* Messages area */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }} className="scroll-container">
        {loading && <div style={{ padding: "var(--space-xl)", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>}
        {!loading && messages.length === 0 && <div style={{ padding: "var(--space-xl)", textAlign: "center", color: "var(--text-muted)" }}>No messages yet. Start the conversation!</div>}
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const isGroupStart = !prev || prev.author.id !== msg.author.id ||
            (new Date(msg.timestamp).getTime() - new Date(prev.timestamp).getTime() > 5 * 60 * 1000);
          return <MessageItem key={msg.id} message={msg} isGroupStart={isGroupStart} />;
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area - matches Discord style */}
      <div style={{
        padding: "var(--space-sm) var(--space-md)",
        flexShrink: 0,
        background: "var(--bg-secondary)",
      }}>
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const content = input.trim();
              if (!content) return;
              setInput("");
              useThreadStore.getState().sendMessage(activeThread.id, content);
            }
          }}
          placeholder={`Message #${displayName}`}
          style={{
            width: "100%",
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--space-sm)",
            border: "none",
            background: "var(--channeltextarea-background, var(--bg-primary))",
            color: "var(--text-normal)",
            fontSize: "var(--font-size-md)",
            outline: "none",
            resize: "none",
          }}
        />
      </div>
    </div>
  );
}
