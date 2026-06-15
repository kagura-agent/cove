import { useState, useEffect, useRef } from "react";
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
  const [showMenu, setShowMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Close menu on outside click or Escape
  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        menuBtnRef.current && !menuBtnRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false);
        setConfirmDelete(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowMenu(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showMenu]);

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

  async function handleArchive() {
    try {
      await api.updateChannel(activeThread!.id, { archived: true });
      useThreadStore.getState().removeThread(activeThread!.id);
    } catch (err) {
      console.error("archive thread:", err);
    }
    setShowMenu(false);
    closeThread();
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deleteChannel(activeThread!.id);
      useThreadStore.getState().removeThread(activeThread!.id);
    } catch (err) {
      console.error("delete thread:", err);
    }
    setShowMenu(false);
    closeThread();
  }

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
        <div style={{ position: "relative" }}>
          <button
            ref={menuBtnRef}
            onClick={() => { setShowMenu((v) => !v); setConfirmDelete(false); }}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: "var(--font-size-xl)",
              cursor: "pointer",
              padding: "var(--space-xs)",
              lineHeight: 1,
            }}
          >&#x22EF;</button>
          {showMenu && (
            <div ref={menuRef} style={{
              position: "absolute",
              top: "100%",
              right: 0,
              zIndex: 1000,
              background: "var(--bg-floating)",
              borderRadius: "var(--space-xs)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              padding: "var(--space-xs) 0",
              minWidth: 180,
            }}>
              <div
                onClick={handleArchive}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "var(--space-xs) var(--space-md)",
                  cursor: "pointer",
                  fontSize: "var(--font-size-md)",
                  color: "var(--text-normal)",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-modifier-hover)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
              >Archive Thread</div>
              <div style={{ height: 1, margin: "var(--space-xs) 0", background: "var(--border-subtle)" }} />
              <div
                onClick={handleDelete}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "var(--space-xs) var(--space-md)",
                  cursor: "pointer",
                  fontSize: "var(--font-size-md)",
                  color: "var(--status-danger, #ed4245)",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "color-mix(in srgb, var(--status-danger, #ed4245) 15%, transparent)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
              >{confirmDelete ? "Confirm Delete" : "Delete Thread"}</div>
            </div>
          )}
        </div>
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
