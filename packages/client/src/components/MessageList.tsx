import { useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useMessageStore } from "../stores/useMessageStore";
import { useReadStateStore } from "../stores/useReadStateStore";
import { useUserStore } from "../stores/useUserStore";
import { MessageItem } from "./MessageItem";
import { TypingIndicator } from "./TypingIndicator";
import { Spin, Empty } from "antd";
import * as api from "../lib/api";
import type { CSSProperties } from "react";

const centerStyle: CSSProperties = { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" };
const listStyle: CSSProperties = { flex: 1, overflowY: "auto", paddingTop: "var(--space-sm)", paddingBottom: 0, paddingLeft: 0, paddingRight: 0, display: "flex", flexDirection: "column", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", position: "relative" };
const NEAR_BOTTOM_THRESHOLD = 100;

/** Persists across mounts so revisiting a channel with no new messages skips the ack call. */
const lastAckedIds = new Map<string, string>();

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD;
}

/* ── NEW Divider ─────────────────────────────────────────── */
const newDividerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "4px var(--content-pad)",
  gap: "8px",
  userSelect: "none",
};
const newDividerLineStyle: CSSProperties = {
  flex: 1,
  height: "1px",
  background: "var(--danger)",
};
const newDividerLabelStyle: CSSProperties = {
  color: "var(--danger)",
  fontSize: "var(--font-size-xs)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
};

function NewMessagesDivider() {
  return (
    <div style={newDividerStyle} aria-label="New messages">
      <div style={newDividerLineStyle} />
      <span style={newDividerLabelStyle}>NEW</span>
      <div style={newDividerLineStyle} />
    </div>
  );
}

/**
 * Scroll Policy (Discord-style):
 *
 * SCROLL TO BOTTOM when:
 *   1. Opening a channel with NO unread messages
 *   2. New message arrives while user is already at bottom
 *   3. User sends a message
 *
 * SCROLL TO DIVIDER when:
 *   4. Opening a channel WITH unread messages → scroll to NEW divider
 *
 * DON'T SCROLL when:
 *   5. New message arrives while user is scrolled UP
 *
 * NEW DIVIDER disappears when:
 *   - User sends a message (clears snapshot)
 *   - User switches channel (unmount clears snapshot)
 *
 * ACK (mark as read on server) when:
 *   - User scrolls to bottom (but divider stays)
 *   - User sends a message
 */
export function MessageList({ channelId }: { channelId: string }) {
  const messages = useMessageStore((s) => s.messages[channelId]);
  const setMessages = useMessageStore((s) => s.setMessages);
  const channelOpenReadId = useReadStateStore((s) => s.channelOpenReadIds[channelId]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const wasNearBottomRef = useRef(true);

  /**
   * THE KEY MECHANISM: Set this to true before any programmatic scroll.
   * The scroll handler checks it to distinguish programmatic vs user scrolls.
   * It's cleared on the first scroll event after being set.
   */
  const isProgrammaticScrollRef = useRef(false);

  /**
   * Track whether initial load is complete. Scroll events before this are ignored entirely.
   * This handles the edge case where the browser fires scroll events during initial render/layout.
   */
  const isLoadedRef = useRef(false);

  // Helper: perform a programmatic scroll to bottom
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    isProgrammaticScrollRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  // Snapshot read state when opening a channel
  useEffect(() => {
    const store = useReadStateStore.getState();
    if (store.unreadChannels[channelId]) {
      store.snapshotChannelOpen(channelId);
    }
    return () => {
      useReadStateStore.getState().clearChannelOpenSnapshot(channelId);
    };
  }, [channelId]);

  // ── Channel Load Effect ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    // Reset state for new channel
    prevCountRef.current = 0;
    wasNearBottomRef.current = true;
    isLoadedRef.current = false;
    isProgrammaticScrollRef.current = false;

    api.fetchMessages(channelId).then((msgs) => {
      if (cancelled) return;
      const reversed = msgs.reverse();

      // Pre-set scroll to bottom before React renders to avoid visual flash
      // (messages appear at correct position without a frame of showing from top)
      const container = scrollContainerRef.current;
      if (container) {
        container.style.opacity = "0";
      }

      setMessages(channelId, reversed);
      prevCountRef.current = reversed.length;

      const openReadId = useReadStateStore.getState().channelOpenReadIds[channelId];

      if (openReadId) {
        // Channel has unread messages → find first unread
        const firstUnreadIdx = reversed.findIndex((m) => m.id > openReadId);
        if (firstUnreadIdx !== -1) {
          wasNearBottomRef.current = false;

          // Policy #4: Scroll to divider, not bottom
          requestAnimationFrame(() => {
            if (cancelled) return;
            isProgrammaticScrollRef.current = true;
            if (dividerRef.current) {
              dividerRef.current.scrollIntoView({ behavior: "instant", block: "start" });
            } else {
              bottomRef.current?.scrollIntoView({ behavior: "instant" });
            }
            if (container) container.style.opacity = "1";
            requestAnimationFrame(() => { isLoadedRef.current = true; });
          });
        } else {
          // openReadId exists but all messages are read → scroll to bottom
          requestAnimationFrame(() => {
            if (cancelled) return;
            isProgrammaticScrollRef.current = true;
            bottomRef.current?.scrollIntoView({ behavior: "instant" });
            if (container) container.style.opacity = "1";
            requestAnimationFrame(() => { isLoadedRef.current = true; });
          });
        }
      } else {
        // Policy #1: No unread → scroll to bottom
        requestAnimationFrame(() => {
          if (cancelled) return;
          isProgrammaticScrollRef.current = true;
          bottomRef.current?.scrollIntoView({ behavior: "instant" });
          if (container) container.style.opacity = "1";
          requestAnimationFrame(() => { isLoadedRef.current = true; });
        });
      }
    }).catch((err) => console.error("loadMessages:", err));

    return () => {
      cancelled = true;
      // Ack on leave: mark channel as read when switching away
      const currentMessages = useMessageStore.getState().messages[channelId];
      if (currentMessages && currentMessages.length > 0) {
        const lastMessage = currentMessages[currentMessages.length - 1];
        if (!lastMessage.id.startsWith("pending-") && lastMessage.id !== lastAckedIds.get(channelId)) {
          lastAckedIds.set(channelId, lastMessage.id);
          useReadStateStore.getState().clearUnread(channelId);
          api.ackMessage(channelId, lastMessage.id).catch(() => {});
        }
      }
    };
  }, [channelId, setMessages]);

  // ── Scroll Event Handler (bound once per channel) ────────
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      // Ignore scroll events before initial load completes
      if (!isLoadedRef.current) {
        isProgrammaticScrollRef.current = false;
        return;
      }

      // If this scroll was programmatic, consume the flag and skip ack logic
      if (isProgrammaticScrollRef.current) {
        isProgrammaticScrollRef.current = false;
        // Still update wasNearBottom for future "new message" decisions
        wasNearBottomRef.current = isNearBottom(container);
        return;
      }

      // This is a user-initiated scroll
      // If content doesn't overflow, don't auto-clear (only sending a message clears)
      if (container.scrollHeight <= container.clientHeight) return;

      wasNearBottomRef.current = isNearBottom(container);

      // User scrolled to bottom → ack the messages (but divider STAYS per Discord behavior)
      if (wasNearBottomRef.current) {
        const store = useReadStateStore.getState();
        const hasOpenSnapshot = !!store.channelOpenReadIds[channelId];
        if (hasOpenSnapshot) {
          // Ack the last message on server
          const currentMessages = useMessageStore.getState().messages[channelId];
          if (currentMessages && currentMessages.length > 0) {
            const lastMessage = currentMessages[currentMessages.length - 1];
            if (!lastMessage.id.startsWith("pending-")) {
              lastAckedIds.set(channelId, lastMessage.id);
              store.clearUnread(channelId);
              api.ackMessage(channelId, lastMessage.id).catch(() => {});
            }
          }
        }
      }
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [channelId]);

  // ── New message arrival effect ───────────────────────────
  const currentUserId = useUserStore((s) => s.id);
  useEffect(() => {
    if (!messages) return;
    if (messages.length > prevCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      const isMine = lastMsg.author.id === currentUserId;

      if (isMine) {
        // User sent a message → clear divider + ack + scroll to bottom
        wasNearBottomRef.current = true;
        useReadStateStore.getState().clearChannelOpenSnapshot(channelId);
        useReadStateStore.getState().clearUnread(channelId);
        if (lastMsg.id !== lastAckedIds.get(channelId) && !lastMsg.id.startsWith("pending-")) {
          lastAckedIds.set(channelId, lastMsg.id);
          api.ackMessage(channelId, lastMsg.id).catch(() => {});
        }
        requestAnimationFrame(() => scrollToBottom());
      } else if (wasNearBottomRef.current) {
        // Policy #2: User at bottom + new message from others → keep at bottom
        requestAnimationFrame(() => scrollToBottom());
      }
      // Policy #5: User scrolled up + new message from others → don't scroll (no banner)
    }
    prevCountRef.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages?.length, scrollToBottom, currentUserId, channelId]);

  // Auto-scroll when last message content changes (e.g. edit) while at bottom
  const lastMessageContent = messages?.[messages.length - 1]?.content;
  useEffect(() => {
    if (!messages) return;
    if (wasNearBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessageContent, scrollToBottom]);

  // Auto-scroll when reactions change on the last message (pill height may grow)
  const lastMsg = messages?.[messages.length - 1];
  const lastMsgReactionKey = lastMsg ? `${lastMsg.id}:${(lastMsg.reactions ?? []).reduce((s, r) => s + r.count, 0)}` : "";
  useEffect(() => {
    if (!messages || !lastMsgReactionKey) return;
    if (wasNearBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMsgReactionKey, scrollToBottom]);

  // Memoize divider index (must be before early returns to satisfy hooks rules)
  const dividerBeforeIndex = useMemo(() => {
    if (!channelOpenReadId || !messages) return -1;
    return messages.findIndex((m) => m.id > channelOpenReadId);
  }, [messages, channelOpenReadId]);

  if (!messages) {
    return <div style={centerStyle}><Spin tip="Loading messages…" /></div>;
  }

  if (messages.length === 0) {
    return (
      <div style={centerStyle}>
        <Empty image="🌊" imageStyle={{ fontSize: 48, lineHeight: "56px" }} description="No messages yet — be the first!" />
      </div>
    );
  }

  return (
    <>
      <div ref={scrollContainerRef} style={listStyle} className="scroll-container">
        {messages.map((msg, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const isGroupStart = !prev || prev.author.id !== msg.author.id ||
            (new Date(msg.timestamp).getTime() - new Date(prev.timestamp).getTime() > 7 * 60 * 1000);
          const showDivider = i === dividerBeforeIndex;
          return (
            <Fragment key={msg.id}>
              {showDivider && <div ref={dividerRef}><NewMessagesDivider /></div>}
              <MessageItem message={msg} isGroupStart={showDivider || isGroupStart} />
            </Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <TypingIndicator channelId={channelId} />
    </>
  );
}
