import type { Message } from "../types";
import type { CSSProperties } from "react";

const quoteWrapperStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  padding: "2px 0 2px 0",
  marginBottom: 2,
  fontSize: "var(--font-size-sm)",
  color: "var(--text-muted)",
  cursor: "pointer",
};

const accentBarStyle: CSSProperties = {
  width: 2,
  height: 16,
  borderRadius: 1,
  background: "var(--accent)",
  flexShrink: 0,
};

const contentStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
  flex: 1,
};

interface Props {
  referencedMessage: Message | null | undefined;
  onClickJump?: (messageId: string) => void;
}

export function MessageReplyQuote({ referencedMessage, onClickJump }: Props) {
  if (!referencedMessage) {
    return (
      <div style={quoteWrapperStyle}>
        <div style={accentBarStyle} />
        <span style={{ fontStyle: "italic" }}>Original message was deleted</span>
      </div>
    );
  }

  return (
    <div
      style={quoteWrapperStyle}
      onClick={() => onClickJump?.(referencedMessage.id)}
      title="Click to jump to message"
    >
      <div style={accentBarStyle} />
      <span style={{ fontWeight: 600, flexShrink: 0 }}>{referencedMessage.author.username}</span>
      <span style={contentStyle}>{referencedMessage.content}</span>
    </div>
  );
}
