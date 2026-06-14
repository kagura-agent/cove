import { useState, useRef, useEffect, type CSSProperties } from "react";
import { useThreadStore } from "../stores/useThreadStore";
import { ChatMarkdown } from "./ChatMarkdown";
import { pickAvatarColor, getContrastTextColor } from "../lib/avatar-palette";

const panelStyle: CSSProperties = {
  width: "var(--thread-panel-width, 400px)",
  maxWidth: "100vw",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-secondary)",
  borderLeft: "1px solid var(--border-subtle)",
  flexShrink: 0,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "var(--space-sm) var(--space-md)",
  borderBottom: "1px solid var(--border-subtle)",
  flexShrink: 0,
};

const headerTitleStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: "var(--font-size-lg)",
  color: "var(--header-primary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const closeBtnStyle: CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  fontSize: "var(--font-size-xl)",
  cursor: "pointer",
  padding: "var(--space-xs)",
  borderRadius: "var(--space-xs)",
  lineHeight: 1,
};

const messagesContainerStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "var(--space-sm)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
};

const inputContainerStyle: CSSProperties = {
  padding: "var(--space-sm) var(--space-md)",
  borderTop: "1px solid var(--border-subtle)",
  flexShrink: 0,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "var(--space-sm) var(--space-md)",
  borderRadius: "var(--space-sm)",
  border: "none",
  background: "var(--bg-primary)",
  color: "var(--text-normal)",
  fontSize: "var(--font-size-md)",
  outline: "none",
  resize: "none",
};

const emptyStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: 1,
  color: "var(--text-muted)",
  fontSize: "var(--font-size-md)",
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

interface ThreadMessageProps {
  message: { id: string; content: string; author: { username: string; global_name?: string | null; bot: boolean }; timestamp: string };
}

function ThreadMessage({ message }: ThreadMessageProps) {
  const initial = message.author.username.charAt(0).toUpperCase();
  const bgColor = pickAvatarColor(message.author.username);
  const textColor = getContrastTextColor(bgColor);
  const displayName = message.author.global_name || message.author.username;

  return (
    <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-start" }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%", backgroundColor: bgColor,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "var(--font-size-sm)", fontWeight: 600, color: textColor, flexShrink: 0,
      }}>
        {initial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-xs)" }}>
          <span style={{ fontWeight: 500, fontSize: "var(--font-size-md)", color: "var(--header-primary)" }}>
            {displayName}
          </span>
          <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
            {formatTime(message.timestamp)}
          </span>
        </div>
        <div style={{ fontSize: "var(--font-size-md)", color: "var(--text-normal)", wordBreak: "break-word" }}>
          <ChatMarkdown content={message.content} mentionUsers={new Map()} />
        </div>
      </div>
    </div>
  );
}

export function ThreadPanel() {
  const activeThread = useThreadStore((s) => s.activeThread);
  const messages = useThreadStore((s) => s.threadMessages);
  const loading = useThreadStore((s) => s.threadMessagesLoading);
  const closeThread = useThreadStore((s) => s.closeThread);
  const sendMsg = useThreadStore((s) => s.sendMessage);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (!activeThread) return null;

  const handleSend = async () => {
    const content = input.trim();
    if (!content) return;
    setInput("");
    await sendMsg(activeThread.id, content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={panelStyle} className="thread-panel">
      <div style={headerStyle}>
        <div style={headerTitleStyle}>Thread: {activeThread.name}</div>
        <button style={closeBtnStyle} onClick={closeThread} title="Close thread">✕</button>
      </div>

      <div style={messagesContainerStyle}>
        {loading && <div style={emptyStyle}>Loading...</div>}
        {!loading && messages.length === 0 && <div style={emptyStyle}>No messages yet</div>}
        {messages.map((msg) => (
          <ThreadMessage key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div style={inputContainerStyle}>
        <textarea
          style={inputStyle}
          rows={1}
          placeholder={`Message #${activeThread.name}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
