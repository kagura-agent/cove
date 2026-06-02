import { Typography } from "antd";
import type { Message } from "../types";
import type { CSSProperties } from "react";

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

/** Generate a consistent color from username for avatar background */
function avatarColor(name: string): string {
  const colors = ["#5865f2", "#57f287", "#fee75c", "#eb459e", "#ed4245", "#f47b67", "#e78284", "#3ba55d"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ── Styles ──────────────────────────────────────────────────────────────────

const rowStyle: CSSProperties = {
  display: "flex",
  padding: "2px 48px 2px 72px",
  position: "relative",
  minHeight: 22,
};

const rowHoverBg = "rgba(255,255,255,0.02)";

const groupStartRowStyle: CSSProperties = {
  ...rowStyle,
  marginTop: 16,
  padding: "2px 48px 2px 72px",
};

const avatarStyle: CSSProperties = {
  position: "absolute",
  left: 16,
  top: 2,
  width: 40,
  height: 40,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 18,
  fontWeight: 600,
  color: "#fff",
  flexShrink: 0,
  cursor: "pointer",
};

const compactTimestampStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  width: 56,
  textAlign: "right",
  paddingRight: 4,
  fontSize: 11,
  color: "var(--text-secondary)",
  lineHeight: "22px",
  opacity: 0,
  userSelect: "none",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  lineHeight: "22px",
};

const usernameStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 500,
  cursor: "pointer",
};

const timestampStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
  marginLeft: 4,
};

const botBadgeStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#fff",
  background: "#5865f2",
  borderRadius: 3,
  padding: "1px 5px",
  marginLeft: 4,
  verticalAlign: "middle",
  lineHeight: "16px",
  display: "inline-block",
  position: "relative",
  top: -1,
};

const contentStyle: CSSProperties = {
  whiteSpace: "pre-wrap",
  color: "var(--text-primary)",
  fontSize: 16,
  lineHeight: "22px",
  wordBreak: "break-word",
};

const editedStyle: CSSProperties = {
  fontSize: 10,
  color: "var(--text-secondary)",
  opacity: 0.6,
  marginLeft: 4,
  userSelect: "none",
};

// Role colors matching Discord
function roleColor(isBot: boolean): string {
  return isBot ? "#7289da" : "#f4a261";
}

interface MessageItemProps {
  message: Message;
  isGroupStart: boolean;
}

export function MessageItem({ message, isGroupStart }: MessageItemProps) {
  const isBot = message.author.bot;
  const initial = message.author.username.charAt(0).toUpperCase();
  const bgColor = avatarColor(message.author.username);

  return (
    <div
      className="discord-msg-row"
      style={isGroupStart ? groupStartRowStyle : rowStyle}
      onMouseEnter={(e) => { e.currentTarget.style.background = rowHoverBg; const ts = e.currentTarget.querySelector('.compact-ts') as HTMLElement; if (ts) ts.style.opacity = '1'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = ''; const ts = e.currentTarget.querySelector('.compact-ts') as HTMLElement; if (ts) ts.style.opacity = '0'; }}
    >
      {isGroupStart ? (
        <div style={{ ...avatarStyle, backgroundColor: bgColor }}>
          {initial}
        </div>
      ) : (
        <span className="compact-ts" style={compactTimestampStyle}>
          {formatCompactTime(message.timestamp)}
        </span>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {isGroupStart && (
          <div style={headerStyle}>
            <span style={{ ...usernameStyle, color: roleColor(isBot) }}>
              {message.author.username}
            </span>
            {isBot && <span style={botBadgeStyle}>BOT</span>}
            <Typography.Text type="secondary" style={timestampStyle}>
              {formatTime(message.timestamp)}
            </Typography.Text>
          </div>
        )}
        <div style={contentStyle}>
          {message.content}
          {message.edited_timestamp && <span style={editedStyle}>(edited)</span>}
        </div>
      </div>
    </div>
  );
}
