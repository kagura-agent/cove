import { useThreadStore } from "../stores/useThreadStore";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ReplyBar } from "./ReplyBar";

export function ThreadPanel() {
  const activeThread = useThreadStore((s) => s.activeThread);
  const closeThread = useThreadStore((s) => s.closeThread);

  if (!activeThread) return null;

  const displayName = activeThread.name.length > 40
    ? activeThread.name.slice(0, 40) + "\u2026"
    : activeThread.name;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      width: "100%",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "0 var(--space-md)",
        height: "var(--header-height)",
        borderBottom: "1px solid var(--border-subtle)",
        flexShrink: 0,
        background: "var(--bg-secondary)",
      }}>
        <span style={{ fontSize: "var(--font-size-lg)", color: "var(--text-muted)" }}>#</span>
        <span style={{
          flex: 1,
          fontWeight: 600,
          fontSize: "var(--font-size-lg)",
          color: "var(--header-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>{displayName}</span>
        <button
          onClick={closeThread}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: "var(--font-size-xl)",
            cursor: "pointer",
            padding: "var(--space-xs)",
            lineHeight: 1,
          }}
        >&#10005;</button>
      </div>

      {/* Reuse the exact same MessageList component as main chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", background: "var(--bg-primary)" }}>
        <MessageList channelId={activeThread.id} />
      </div>

      {/* Reuse the exact same input as main chat */}
      <div style={{ flexShrink: 0, background: "var(--bg-secondary)" }}>
        <ReplyBar channelId={activeThread.id} />
        <MessageInput channelId={activeThread.id} />
      </div>
    </div>
  );
}
