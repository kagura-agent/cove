import { Typography } from "antd";
import type { Message } from "../types";
import type { CSSProperties } from "react";
import { pickAvatarColor, MESSAGE_AVATAR_COLORS } from "../lib/avatar-palette";

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return `Today at ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
    if (isYesterday) return `Yesterday at ${time}`;
    return `${d.toLocaleDateString([], { month: "2-digit", day: "2-digit", year: "numeric" })} ${time}`;
  } catch { return ""; }
}

function formatCompactTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function avatarColor(name: string): string {
  return pickAvatarColor(name, MESSAGE_AVATAR_COLORS);
}

function roleColor(isBot: boolean): string {
  return isBot ? "var(--text-bot)" : "var(--text-user)";
}

const botBadgeStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "var(--header-primary)",
  background: "var(--accent)",
  borderRadius: 3,
  padding: "1px 5px",
  marginLeft: 6,
  verticalAlign: "middle",
  lineHeight: "14px",
  display: "inline-block",
};

const editedStyle: CSSProperties = {
  fontSize: 10,
  color: "var(--text-muted)",
  opacity: 0.6,
  marginLeft: 4,
  userSelect: "none",
};

interface MessageItemProps {
  message: Message;
  isGroupStart: boolean;
}

export function MessageItem({ message, isGroupStart }: MessageItemProps) {
  const isBot = message.author.bot;
  const initial = message.author.username.charAt(0).toUpperCase();
  const bgColor = avatarColor(message.author.username);

  if (isGroupStart) {
    return (
      <div
        className="discord-msg-row"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
          padding: "4px 48px 0 16px",
          marginTop: 16,
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            backgroundColor: bgColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            fontWeight: 600,
            color: "var(--header-primary)",
            flexShrink: 0,
            cursor: "pointer",
          }}
        >
          {initial}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header: username + badge + timestamp */}
          <div style={{ display: "flex", alignItems: "baseline", lineHeight: "22px" }}>
            <span
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: roleColor(isBot),
                cursor: "pointer",
              }}
            >
              {message.author.username}
            </span>
            {isBot && <span style={botBadgeStyle}>BOT</span>}
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}
            >
              {formatTime(message.timestamp)}
            </Typography.Text>
          </div>

          {/* Message body */}
          <div
            style={{
              whiteSpace: "pre-wrap",
              color: "var(--text-normal)",
              fontSize: 16,
              lineHeight: 1.375,
              wordBreak: "break-word",
            }}
          >
            {message.content}
            {message.edited_timestamp && <span style={editedStyle}>(edited)</span>}
          </div>
        </div>
      </div>
    );
  }

  // Grouped (continuation) message — no avatar, show compact timestamp on hover
  return (
    <div
      className="discord-msg-row"
      style={{
        display: "flex",
        alignItems: "flex-start",
        padding: "2px 48px 0 72px",
      }}
    >
      <span className="compact-ts">
        {formatCompactTime(message.timestamp)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            whiteSpace: "pre-wrap",
            color: "var(--text-normal)",
            fontSize: 16,
            lineHeight: 1.375,
            wordBreak: "break-word",
          }}
        >
          {message.content}
          {message.edited_timestamp && <span style={editedStyle}>(edited)</span>}
        </div>
      </div>
    </div>
  );
}
