import { useState } from "react";
import { useThreadStore } from "../stores/useThreadStore";

interface Props {
  thread: { id: string; name: string; message_count: number };
  channelId: string;
}

export function ThreadIndicator({ thread }: Props) {
  const fetchAndOpen = useThreadStore((s) => s.fetchAndOpenThread);
  const [hovered, setHovered] = useState(false);

  const count = thread.message_count;
  const label = count === 1 ? "1 Reply" : `${count} Replies`;

  return (
    <div
      onClick={() => fetchAndOpen(thread.id)}
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
      <span style={{ display: "flex", alignItems: "center" }}>&#128172;</span>
      <span>{label}</span>
      {hovered && <span style={{ fontSize: "var(--font-size-xs)", opacity: 0.7 }}>View Thread &#8250;</span>}
    </div>
  );
}
