import { useState, type CSSProperties } from "react";
import { useThreadStore } from "../stores/useThreadStore";
import type { Channel } from "../types";

const barStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-xs) var(--space-md)",
  marginTop: "var(--space-xs)",
  fontSize: "var(--font-size-sm)",
  color: "var(--accent)",
  cursor: "pointer",
  borderRadius: "var(--space-xs)",
  borderLeft: "2px solid var(--accent)",
  fontWeight: 500,
  transition: "background 0.15s",
};

const barHoverStyle: CSSProperties = {
  background: "var(--bg-modifier-hover)",
};

const arrowStyle: CSSProperties = {
  marginLeft: "auto",
  fontSize: "var(--font-size-xs)",
  opacity: 0.7,
};

interface Props {
  thread: { id: string; name: string; message_count: number };
  channelId: string;
}

export function ThreadIndicator({ thread }: Props) {
  const openThread = useThreadStore((s) => s.openThread);
  const [hovered, setHovered] = useState(false);

  const handleClick = () => {
    openThread({
      id: thread.id,
      name: thread.name,
      type: 11,
      guild_id: "",
      topic: null,
      position: 0,
      last_message_id: null,
      permission_overwrites: [],
      nsfw: false,
      rate_limit_per_user: 0,
      message_count: thread.message_count,
    } as Channel);
  };

  const count = thread.message_count;
  const label = count === 1 ? "1 Reply" : `${count} Replies`;

  return (
    <div
      className="thread-indicator"
      style={{ ...barStyle, ...(hovered ? barHoverStyle : {}) }}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: "var(--font-size-md)" }}>💬</span>
      <span style={{ fontWeight: 600 }}>{thread.name}</span>
      <span style={{ opacity: 0.8 }}>{label}</span>
      <span style={arrowStyle}>View Thread ›</span>
    </div>
  );
}
