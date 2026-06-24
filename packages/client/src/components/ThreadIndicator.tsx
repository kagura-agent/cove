import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveIds } from "../hooks/useActiveIds";
import { routes } from "../lib/routes";
import type { Channel } from "../types";
import { ThreadIcon } from "./ThreadIcon";

interface Props {
  thread: Channel;
  channelId: string;
}

export function ThreadIndicator({ thread, channelId }: Props) {
  const navigate = useNavigate();
  const { guildId } = useActiveIds();
  const [hovered, setHovered] = useState(false);

  const count = thread.message_count;
  const label = count === 1 ? "1 Reply" : `${count} Replies`;

  function handleClick() {
    if (guildId) {
      navigate(routes.thread(guildId, channelId, thread.id));
    }
  }

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "4px var(--space-sm)",
        marginTop: "4px",
        borderRadius: "var(--space-xs)",
        cursor: "pointer",
        color: "var(--text-link, #00aff4)",
        fontSize: "var(--font-size-sm)",
        fontWeight: 500,
        background: hovered ? "var(--bg-modifier-hover)" : "transparent",
        transition: "background 0.15s",
      }}
    >
      <ThreadIcon size={16} style={{ color: "var(--text-link, #00aff4)" }} />
      <span>{label}</span>
      {hovered && <span style={{ fontSize: "var(--font-size-xs)", opacity: 0.7 }}>View Thread &#8250;</span>}
    </div>
  );
}
