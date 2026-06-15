import { useState, useEffect } from "react";
import { useThreadStore } from "../stores/useThreadStore";
import { useMessageStore } from "../stores/useMessageStore";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { MessageItem } from "./MessageItem";
import { ReplyBar } from "./ReplyBar";
import * as api from "../lib/api";
import type { Message } from "../types";

export function ThreadPanel() {
  const activeThread = useThreadStore((s) => s.activeThread);
  const closeThread = useThreadStore((s) => s.closeThread);
  const [parentMessage, setParentMessage] = useState<Message | null>(null);

  useEffect(() => {
    if (!activeThread?.message_id || !activeThread?.parent_id) {
      setParentMessage(null);
      return;
    }

    const parentId = activeThread.parent_id;
    const messageId = activeThread.message_id;

    // Try message store first
    const storeMessages = useMessageStore.getState().messages[parentId] ?? [];
    const found = storeMessages.find((m) => m.id === messageId);
    if (found) {
      setParentMessage(found);
      return;
    }

    // Fetch from API
    api
      .fetchMessage(parentId, messageId)
      .then((msg) => setParentMessage(msg))
      .catch(() => setParentMessage(null));
  }, [activeThread?.id, activeThread?.message_id, activeThread?.parent_id]);

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

      {/* Message area: parent message + thread messages in one scroll flow */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", background: "var(--bg-primary)" }}>
        <MessageList channelId={activeThread.id} parentMessage={parentMessage} />
      </div>

      {/* Reuse the exact same input as main chat */}
      <div style={{ flexShrink: 0, background: "var(--bg-secondary)" }}>
        <ReplyBar channelId={activeThread.id} />
        <MessageInput channelId={activeThread.id} />
      </div>
    </div>
  );
}
