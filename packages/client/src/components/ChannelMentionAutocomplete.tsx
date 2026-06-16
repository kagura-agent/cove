import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from "react";
import { useChannelStore } from "../stores/useChannelStore";
import { useGuildStore } from "../stores/useGuildStore";
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
  onSelect: (channelId: string, channelName: string, startPos: number, endPos: number) => void;
  onClose: () => void;
  /** Report whether there are filtered results (for key intercept gating) */
  onHasResults?: (has: boolean) => void;
}

export function ChannelMentionAutocomplete({ text, cursorPos, onSelect, onClose, onHasResults }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const getChannels = useChannelStore((s) => s.getChannels);
  const channels = activeGuildId ? getChannels(activeGuildId) : [];
  // Filter out threads (type 11)
  const textChannels = channels.filter((c) => c.type !== 11);

  // Find the # trigger position
  const trigger = detectMentionTrigger(text, cursorPos, '#');
  const query = trigger?.query ?? null;
  const hashStart = trigger?.start ?? -1;

  const filtered = useMemo(() => {
    if (query === null) return [];
    return textChannels.filter((c) => c.name.toLowerCase().includes(query)).slice(0, 10);
  }, [textChannels, query]);

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
      const ch = filtered[activeIndex];
      if (ch) {
        onSelect(ch.id, ch.name, hashStart, cursorPos);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }, [filtered, activeIndex, hashStart, cursorPos, onSelect, onClose]);

  useEffect(() => {
    if (filtered.length > 0) {
      window.addEventListener("keydown", handleKeyDown, true);
      return () => window.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [filtered.length, handleKeyDown]);

  if (query === null || filtered.length === 0) return null;

  return (
    <div ref={listRef} style={listStyle} role="listbox" aria-label="Channel suggestions" aria-activedescendant={filtered.length > 0 ? 'channel-option-' + filtered[activeIndex]?.id : undefined}>
      {filtered.map((ch, i) => (
        <div
          key={ch.id}
          style={i === activeIndex ? itemActiveStyle : itemStyle}
          onMouseEnter={() => setActiveIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(ch.id, ch.name, hashStart, cursorPos);
          }}
          role="option"
          aria-selected={i === activeIndex}
          id={'channel-option-' + ch.id}
        >
          <span style={{ color: "var(--text-muted)", fontSize: 18, fontWeight: 400, width: 24, textAlign: "center", flexShrink: 0 }}>#</span>
          <span style={{ color: "var(--text-normal)" }}>{ch.name}</span>
        </div>
      ))}
    </div>
  );
}
