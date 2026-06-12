import { CloseOutlined } from "@ant-design/icons";
import { useReplyStore } from "../stores/useReplyStore";
import type { CSSProperties } from "react";

const barStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-xs) var(--content-pad)",
  background: "var(--bg-secondary)",
  borderTop: "1px solid var(--border-subtle)",
  fontSize: "var(--font-size-sm)",
  color: "var(--text-muted)",
  minHeight: 32,
};

const previewStyle: CSSProperties = {
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};

const closeStyle: CSSProperties = {
  cursor: "pointer",
  color: "var(--text-muted)",
  padding: 4,
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
};

export function ReplyBar({ channelId }: { channelId: string }) {
  const replyingTo = useReplyStore((s) => s.replyingTo[channelId]);
  const clearReply = useReplyStore((s) => s.clearReply);

  if (!replyingTo) return null;

  return (
    <div style={barStyle}>
      <span style={{ color: "var(--accent)", flexShrink: 0 }}>↩</span>
      <span style={{ fontWeight: 600, flexShrink: 0, color: "var(--text-normal)" }}>
        {replyingTo.author.username}
      </span>
      <span style={previewStyle}>{replyingTo.content}</span>
      <span style={closeStyle} onClick={() => clearReply(channelId)} title="Cancel reply">
        <CloseOutlined style={{ fontSize: 12 }} />
      </span>
    </div>
  );
}
