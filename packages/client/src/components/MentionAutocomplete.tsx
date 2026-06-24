import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import { useMemberStore } from "../stores/useMemberStore";
import { useActiveIds } from "../hooks/useActiveIds";
import { pickAvatarColor, getContrastTextColor } from "../lib/avatar-palette";
import { detectMentionTrigger } from "../lib/mention-trigger";

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
  text: string;
  cursorPos: number;
  onSelect: (userId: string, username: string, startPos: number, endPos: number) => void;
  onClose: () => void;
  /** Report whether there are filtered results (for key intercept gating) */
  onHasResults?: (has: boolean) => void;
}

export function MentionAutocomplete({ text, cursorPos, onSelect, onClose, onHasResults }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { guildId: activeGuildId } = useActiveIds();
  const getMembers = useMemberStore((s) => s.getMembers);
  const members = activeGuildId ? getMembers(activeGuildId) : [];

  // Find the @ trigger position
  const trigger = detectMentionTrigger(text, cursorPos, '@');
  const query = trigger?.query ?? null;
  const atStart = trigger?.start ?? -1;

  const filtered = query !== null
    ? members.filter((m) => {
        const displayName = (m.user.global_name || m.user.username).toLowerCase();
        const uname = m.user.username.toLowerCase();
        return displayName.includes(query) || uname.includes(query);
      }).slice(0, 10)
    : [];

  // Report whether we have results
  useEffect(() => {
    onHasResults?.(filtered.length > 0);
  }, [filtered.length, onHasResults]);

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
      e.stopImmediatePropagation();
      const member = filtered[activeIndex];
      if (member) {
        onSelect(member.user.id, member.user.global_name || member.user.username, atStart, cursorPos);
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
    <div ref={listRef} style={listStyle} role="listbox" aria-label="Mention suggestions">
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
              onSelect(member.user.id, member.user.global_name || member.user.username, atStart, cursorPos);
            }}
            role="option"
            aria-selected={i === activeIndex}
            id={'mention-option-' + member.user.id}
          >
            <div style={{
              width: 24, height: 24, borderRadius: "50%", backgroundColor: bg,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 600, color: fg, flexShrink: 0,
            }}>
              {(member.user.global_name || member.user.username).charAt(0).toUpperCase()}
            </div>
            <span style={{ color: "var(--text-normal)" }}>{member.user.global_name || member.user.username}</span>
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
