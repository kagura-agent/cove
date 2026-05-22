import { useUserStore } from "../stores/useUserStore";
import { Typography } from "antd";
import type { Message } from "../types";

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

export function MessageItem({ message }: { message: Message }) {
  const userId = useUserStore((s) => s.id);
  const isSelf = message.author.id === userId;

  return (
    <div
      className="animate-fade-in"
      style={{
        maxWidth: "75%",
        padding: "10px 14px",
        borderRadius: 14,
        fontSize: 14,
        lineHeight: 1.6,
        wordBreak: "break-word",
        alignSelf: isSelf ? "flex-end" : "flex-start",
        background: isSelf ? "var(--msg-own)" : "var(--msg-other)",
        borderBottomRightRadius: isSelf ? 4 : 14,
        borderBottomLeftRadius: isSelf ? 14 : 4,
      }}
    >
      <Typography.Text strong style={{ fontSize: 12, color: isSelf ? "#b39ddb" : "#f4a261", display: "block", marginBottom: 2 }}>
        {message.author.username}
      </Typography.Text>
      <div style={{ whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>{message.content}</div>
      <Typography.Text type="secondary" style={{ fontSize: 10, display: "block", textAlign: "right", marginTop: 4, opacity: 0.6 }}>
        {formatTime(message.timestamp)}
      </Typography.Text>
    </div>
  );
}
