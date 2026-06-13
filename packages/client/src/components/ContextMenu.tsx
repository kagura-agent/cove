import { useState, useEffect, useRef, useCallback } from "react";
import type { CSSProperties } from "react";
import type { Message } from "../types";
import * as api from "../lib/api";

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  message: Message | null;
}

export const INITIAL_CONTEXT_MENU: ContextMenuState = {
  visible: false,
  x: 0,
  y: 0,
  message: null,
};

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
};

const menuStyle: CSSProperties = {
  position: "fixed",
  zIndex: 1001,
  minWidth: 188,
  padding: "6px 8px",
  borderRadius: 4,
  background: "var(--bg-floating, #111214)",
  boxShadow: "0 8px 16px rgba(0,0,0,0.24)",
};

const separatorStyle: CSSProperties = {
  height: 1,
  margin: "4px 0",
  background: "var(--bg-modifier-hover, #2e3035)",
};

export function ContextMenu({ state, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset confirm state when menu opens/closes
  useEffect(() => {
    if (!state.visible) setConfirmingDelete(false);
  }, [state.visible]);

  // Position menu within viewport bounds
  useEffect(() => {
    if (!state.visible || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = state.x;
    let y = state.y;
    if (x + rect.width > vw) x = vw - rect.width - 8;
    if (y + rect.height > vh) y = vh - rect.height - 8;
    if (x < 0) x = 8;
    if (y < 0) y = 8;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }, [state.visible, state.x, state.y]);

  // Close on Escape
  useEffect(() => {
    if (!state.visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [state.visible, onClose]);

  const handleCopyText = useCallback(() => {
    if (state.message) {
      navigator.clipboard.writeText(state.message.content).catch(() => {});
    }
    onClose();
  }, [state.message, onClose]);

  const handleCopyId = useCallback(() => {
    if (state.message) {
      navigator.clipboard.writeText(state.message.id).catch(() => {});
    }
    onClose();
  }, [state.message, onClose]);

  const handleDeleteClick = useCallback(() => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    if (state.message) {
      api.deleteMessage(state.message.channel_id, state.message.id).catch(console.error);
    }
    onClose();
  }, [confirmingDelete, state.message, onClose]);

  if (!state.visible || !state.message) return null;

  return (
    <>
      {/* Invisible overlay to catch clicks outside */}
      <div style={overlayStyle} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={menuRef}
        className="context-menu"
        style={{ ...menuStyle, left: state.x, top: state.y }}
        role="menu"
      >
        <button
          type="button"
          className="context-menu-item"
          onClick={handleCopyText}
          role="menuitem"
        >
          Copy Text
        </button>
        <button
          type="button"
          className="context-menu-item"
          onClick={handleCopyId}
          role="menuitem"
        >
          Copy Message ID
        </button>
        <div style={separatorStyle} />
        <button
          type="button"
          className={`context-menu-item context-menu-danger${confirmingDelete ? " context-menu-confirm" : ""}`}
          onClick={handleDeleteClick}
          role="menuitem"
        >
          {confirmingDelete ? "Confirm Delete" : "Delete Message"}
        </button>
      </div>
    </>
  );
}
