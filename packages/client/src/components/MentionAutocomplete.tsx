import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import { useMemberStore } from "../stores/useMemberStore";
import { useGuildStore } from "../stores/useGuildStore";
import { pickAvatarColor, getContrastTextColor } from "../lib/avatar-palette";

const listStyle: CSSProperties = {
  position: "absolute",
  bottom: "100%",
  left: 0,
  right: 0,
  maxHeight: 200,
  overflowY: "auto",
  background: "var(--bg-floating)",
  borderRadius: "var(--input-radius)",
  boxShadow: "0 -4px 12px rgba(0,0,0,0.3)",
  zIndex: 10,
  padding: "var(--space-xs) 0",
  margin: "0 var(--content-pad)",
  marginBottom: "var(--space-xs)",
};

const itemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-xs) var(--space-sm)",
  cursor: "pointer",
  fontSize: "var(--font-size-md)",
};

const itemActiveStyle: CSSProperties = {
  ...itemStyle,
  background: "var(--bg-modifier-hover)",
};

interface Props {
  /** Current input text */
  text: string;
  /** Cursor position in the input */
  cursorPos: number;
  /** Called when a mention is selected; returns the text to insert */
  onSelect: (userId: string, username: string, startPos: number, endPos: number) => void;
  /** Called when popup closes without selection */
  onClose: () => void;
}

export function MentionAutocomplete({ text, cursorPos, onSelect, onClose }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const getMembers = useMemberStore((s) => s.getMembers);
  const members = activeGuildId ? getMembers(activeGuildId) : [];

  // Find the @ trigger position
  const beforeCursor = text.slice(0, cursorPos);
  const atMatch = beforeCursor.match(/@(\w*)$/);
  const query = atMatch ? atMatch[1].toLowerCase() : null;
  const atStart = atMatch ? beforeCursor.length - atMatch[0].length : -1;

  const filtered = query !== null
    ? members.filter((m) => m.user.username.toLowerCase().includes(query)).slice(0, 10)
    : [];

  // Reset active index when filtered list changes
  useEffect(() => {
    setActiveIndex(0);
  }, [filtered.length]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (filtered.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const member = filtered[activeIndex];
      if (member) {
        onSelect(member.user.id, member.user.username, atStart, cursorPos);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }, [filtered, activeIndex, atStart, cursorPos, onSelect, onClose]);

  useEffect(() => {
    if (filtered.length > 0) {
      window.addEventListener("keydown", handleKeyDown, true);
      return () => window.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [filtered.length, handleKeyDown]);

  if (query === null || filtered.length === 0) return null;

  return (
    <div ref={listRef} style={listStyle}>
      {filtered.map((member, i) => {
        const bg = pickAvatarColor(member.user.username);
        const fg = getContrastTextColor(bg);
        return (
          <div
            key={member.user.id}
            style={i === activeIndex ? itemActiveStyle : itemStyle}
            onMouseEnter={() => setActiveIndex(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(member.user.id, member.user.username, atStart, cursorPos);
            }}
          >
            <div style={{
              width: 24, height: 24, borderRadius: "50%", backgroundColor: bg,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 600, color: fg, flexShrink: 0,
            }}>
              {member.user.username.charAt(0).toUpperCase()}
            </div>
            <span style={{ color: "var(--text-normal)" }}>{member.user.username}</span>
            {member.user.bot && (
              <span style={{
                fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--text-on-accent)",
                background: "var(--accent)", borderRadius: "var(--space-xxs)",
                padding: "0 var(--space-xs)", lineHeight: "var(--font-size-md)",
              }}>APP</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
