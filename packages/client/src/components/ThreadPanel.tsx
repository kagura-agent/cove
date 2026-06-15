import { useState, useRef, useEffect, type CSSProperties } from "react";
import { useThreadStore } from "../stores/useThreadStore";
import { useMessageStore } from "../stores/useMessageStore";
import { MessageItem } from "./MessageItem";
import type { Message } from "../types";

const panelStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-secondary)",
  flexShrink: 0,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "0 var(--space-md)",
  borderBottom: "1px solid var(--border-subtle)",
  height: "var(--header-height)",
  flexShrink: 0,
};

const headerTitleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  flex: 1,
  overflow: "hidden",
};

const headerNameStyle: CSSProperties = {
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
  flexShrink: 0,
};

const parentMessageStyle: CSSProperties = {
  borderBottom: "1px solid var(--border-subtle)",
  padding: "var(--space-sm) 0",
  flexShrink: 0,
};

const messagesContainerStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
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

/** Check if two messages are from the same author within 5 minutes */
function shouldGroup(prev: Message | undefined, curr: Message): boolean {
  if (!prev) return false;
  if (prev.author.id !== curr.author.id) return false;
  const dt = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
  return dt < 5 * 60 * 1000;
}

export function ThreadPanel() {
  const activeThread = useThreadStore((s) => s.activeThread);
  const messages = useThreadStore((s) => s.threadMessages);
  const loading = useThreadStore((s) => s.threadMessagesLoading);
  const closeThread = useThreadStore((s) => s.closeThread);
  const sendMsg = useThreadStore((s) => s.sendMessage);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Look up the parent message that spawned this thread
  const parentChannelMessages = useMessageStore((s) => {
    if (!activeThread?.parent_id) return [];
    return s.messages[activeThread.parent_id] ?? [];
  });
  const parentMessage = activeThread?.message_id
    ? parentChannelMessages.find((m) => m.id === activeThread.message_id)
    : undefined;

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
      {/* Header */}
      <div style={headerStyle}>
        <div style={headerTitleStyle}>
          <span style={{ fontSize: "var(--font-size-lg)", opacity: 0.6 }}>💬</span>
          <span style={headerNameStyle}>{activeThread.name}</span>
        </div>
        <button style={closeBtnStyle} onClick={closeThread} title="Close thread">✕</button>
      </div>

      {/* Parent message context */}
      {parentMessage && (
        <div style={parentMessageStyle}>
          <MessageItem message={parentMessage} isGroupStart />
        </div>
      )}

      {/* Thread messages */}
      <div style={messagesContainerStyle} className="scroll-container">
        {loading && <div style={emptyStyle}>Loading...</div>}
        {!loading && messages.length === 0 && <div style={emptyStyle}>No messages yet</div>}
        {messages.map((msg, i) => (
          <MessageItem
            key={msg.id}
            message={msg}
            isGroupStart={!shouldGroup(messages[i - 1], msg)}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
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
