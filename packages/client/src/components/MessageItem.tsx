import { useUserStore } from "../stores/useUserStore";
import { Typography } from "antd";
import type { Message } from "../types";
import type { CSSProperties } from "react";

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return time;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  } catch { return ""; }
}

const baseStyle: CSSProperties = {
  maxWidth: "75%", padding: "10px 14px", borderRadius: 14,
  fontSize: 14, lineHeight: 1.6, wordBreak: "break-word",
};
const contentStyle: CSSProperties = { whiteSpace: "pre-wrap", color: "var(--text-primary)" };
const timeStyle: CSSProperties = { fontSize: 10, display: "block", textAlign: "right", marginTop: 4, opacity: 0.6 };

function bubbleStyle(isSelf: boolean): CSSProperties {
  return {
    ...baseStyle,
    alignSelf: isSelf ? "flex-end" : "flex-start",
    background: isSelf ? "var(--msg-own)" : "var(--msg-other)",
    borderBottomRightRadius: isSelf ? 4 : 14,
    borderBottomLeftRadius: isSelf ? 14 : 4,
  };
}

function authorStyle(isSelf: boolean): CSSProperties {
  return { fontSize: 12, color: isSelf ? "#b39ddb" : "#f4a261", display: "block", marginBottom: 2 };
}

const botBadgeStyle: CSSProperties = {
  fontSize: 10, fontWeight: 600, color: "#fff", background: "#5865f2",
  borderRadius: 3, padding: "1px 4px", marginLeft: 4, verticalAlign: "middle",
};

export function MessageItem({ message }: { message: Message }) {
  const userId = useUserStore((s) => s.id);
  const isSelf = message.author.id === userId;

  return (
    <div className="animate-fade-in" style={bubbleStyle(isSelf)}>
      <Typography.Text strong style={authorStyle(isSelf)}>
        {message.author.username}
        {message.author.bot && <span style={botBadgeStyle}>BOT</span>}
      </Typography.Text>
      <div style={contentStyle}>{message.content}</div>
      <Typography.Text type="secondary" style={timeStyle}>
        {formatTime(message.timestamp)}
      </Typography.Text>
    </div>
  );
}
