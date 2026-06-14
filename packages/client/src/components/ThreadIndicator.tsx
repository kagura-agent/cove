import type { CSSProperties } from "react";
import { useThreadStore } from "../stores/useThreadStore";
import type { Channel } from "../types";

const indicatorStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  padding: "var(--space-xxs) var(--space-sm)",
  marginTop: "var(--space-xxs)",
  fontSize: "var(--font-size-sm)",
  color: "var(--accent)",
  cursor: "pointer",
  borderRadius: "var(--space-xs)",
  fontWeight: 500,
};

interface Props {
  thread: { id: string; name: string; message_count: number };
  channelId: string;
}

export function ThreadIndicator({ thread }: Props) {
  const openThread = useThreadStore((s) => s.openThread);

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
  const label = count === 1 ? "1 reply" : `${count} replies`;

  return (
    <div
      className="thread-indicator"
      style={indicatorStyle}
      onClick={handleClick}
    >
      <span>💬</span>
      <span>{label}</span>
    </div>
  );
}
