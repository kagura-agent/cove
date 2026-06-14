import { useState, useEffect, useRef, type CSSProperties } from "react";
import * as api from "../lib/api";
import { useThreadStore } from "../stores/useThreadStore";

const menuStyle: CSSProperties = {
  position: "fixed",
  zIndex: 1000,
  background: "var(--bg-floating)",
  borderRadius: "var(--space-xs)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
  padding: "var(--space-xs) 0",
  minWidth: 180,
};

const itemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "var(--space-xs) var(--space-md)",
  cursor: "pointer",
  fontSize: "var(--font-size-md)",
  color: "var(--text-normal)",
  gap: "var(--space-sm)",
};

const dangerItemStyle: CSSProperties = {
  ...itemStyle,
  color: "var(--status-danger, #ed4245)",
};

const hoverBg = "var(--bg-modifier-hover)";
const dangerHoverBg = "color-mix(in srgb, var(--status-danger, #ed4245) 15%, transparent)";

const separatorStyle: CSSProperties = {
  height: 1,
  margin: "var(--space-xs) 0",
  background: "var(--border-subtle)",
};

interface Props {
  x: number;
  y: number;
  messageId: string;
  channelId: string;
  content: string;
  isOwnMessage: boolean;
  hasThread: boolean;
  onClose: () => void;
}

export function MessageContextMenu({ x, y, messageId, channelId, content, isOwnMessage, hasThread, onClose }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position adjustment to keep menu in viewport
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    let adjX = x;
    let adjY = y;
    if (x + rect.width > window.innerWidth) adjX = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) adjY = window.innerHeight - rect.height - 8;
    if (adjX < 0) adjX = 8;
    if (adjY < 0) adjY = 8;
    setPos({ x: adjX, y: adjY });
  }, [x, y]);

  // Close on click outside or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  function handleCopyText() {
    navigator.clipboard.writeText(content).catch(() => {});
    onClose();
  }

  function handleCopyId() {
    navigator.clipboard.writeText(messageId).catch(() => {});
    onClose();
  }

  async function handleCreateThread() {
    const name = content.slice(0, 40).trim() || "Thread";
    try {
      const thread = await api.createThreadFromMessage(channelId, messageId, name);
      useThreadStore.getState().openThread(thread);
      useThreadStore.getState().addThread(thread);
    } catch (err) {
      console.error("create thread:", err);
    }
    onClose();
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deleteMessage(channelId, messageId);
    } catch (err) {
      console.error("delete message:", err);
    }
    onClose();
  }

  return (
    <div ref={menuRef} style={{ ...menuStyle, left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <div
        style={{ ...itemStyle, background: hoveredItem === "copy-text" ? hoverBg : undefined }}
        onClick={handleCopyText}
        onMouseEnter={() => setHoveredItem("copy-text")}
        onMouseLeave={() => setHoveredItem(null)}
      >
        Copy Text
      </div>
      <div
        style={{ ...itemStyle, background: hoveredItem === "copy-id" ? hoverBg : undefined }}
        onClick={handleCopyId}
        onMouseEnter={() => setHoveredItem("copy-id")}
        onMouseLeave={() => setHoveredItem(null)}
      >
        Copy Message ID
      </div>
      {!hasThread && (
        <div
          style={{ ...itemStyle, background: hoveredItem === "create-thread" ? hoverBg : undefined }}
          onClick={handleCreateThread}
          onMouseEnter={() => setHoveredItem("create-thread")}
          onMouseLeave={() => setHoveredItem(null)}
        >
          Create Thread
        </div>
      )}
      {isOwnMessage && (
        <>
          <div style={separatorStyle} />
          <div
            style={{
              ...dangerItemStyle,
              background: hoveredItem === "delete" ? dangerHoverBg : undefined,
            }}
            onClick={handleDelete}
            onMouseEnter={() => setHoveredItem("delete")}
            onMouseLeave={() => setHoveredItem(null)}
          >
            {confirmDelete ? "Confirm Delete" : "Delete Message"}
          </div>
        </>
      )}
    </div>
  );
}
