import { useEffect, useRef, useCallback, useState, useMemo, Fragment } from "react";
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

/* ── Unread Banner ───────────────────────────────────────── */
const bannerWrapperStyle: CSSProperties = {
  position: "relative",
  zIndex: 10,
  flexShrink: 0,
};
const bannerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px var(--content-pad)",
  background: "var(--accent)",
  color: "var(--text-on-accent)",
  fontSize: "var(--font-size-sm)",
  fontWeight: 500,
  cursor: "pointer",
  flexShrink: 0,
};
const bannerDismissStyle: CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-on-accent)",
  cursor: "pointer",
  fontSize: "var(--font-size-sm)",
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: "4px",
  opacity: 0.9,
};

type BannerMode = "catchup" | "live";

/**
 * Scroll Policy (unified):
 *
 * SCROLL TO BOTTOM when:
 *   1. Opening a channel with NO unread messages
 *   2. New message arrives while user is already at bottom
 *   3. User sends a message (handled by parent — we just see message count increase while near bottom)
 *
 * SCROLL TO DIVIDER when:
 *   4. Opening a channel WITH unread messages → scroll to NEW divider
 *
 * DON'T SCROLL when:
 *   5. New message arrives while user is scrolled UP → show/update banner instead
 *
 * CLEAR UNREAD (ack + remove divider + hide banner) when:
 *   6. User MANUALLY scrolls to bottom (not programmatic scroll)
 *   7. User clicks "Mark as Read" button
 *
 * Key mechanism: `isProgrammaticScrollRef` is set to true before any programmatic
 * scroll and cleared in the scroll handler. This distinguishes user scrolls from
 * programmatic ones without timing hacks.
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
  const [showBanner, setShowBanner] = useState(false);
  const [unreadInfo, setUnreadInfo] = useState<{ count: number; since: string } | null>(null);

  // Banner mode: "catchup" = initial unread, "live" = new messages while scrolled up
  const bannerModeRef = useRef<BannerMode>("catchup");

  // Ref mirror of showBanner for use in scroll handler without re-binding
  const showBannerRef = useRef(false);
  showBannerRef.current = showBanner;

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

  // Helper: perform a programmatic scroll to divider
  const scrollToDivider = useCallback(() => {
    isProgrammaticScrollRef.current = true;
    dividerRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
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
    setShowBanner(false);
    setUnreadInfo(null);
    bannerModeRef.current = "catchup";

    api.fetchMessages(channelId).then((msgs) => {
      if (cancelled) return;
      const reversed = msgs.reverse();
      setMessages(channelId, reversed);
      prevCountRef.current = reversed.length;

      const openReadId = useReadStateStore.getState().channelOpenReadIds[channelId];

      if (openReadId) {
        // Channel has unread messages → find first unread
        const firstUnreadIdx = reversed.findIndex((m) => m.id > openReadId);
        if (firstUnreadIdx !== -1) {
          // Calculate unread info for banner
          const unreadCount = reversed.length - firstUnreadIdx;
          const firstUnreadTime = new Date(reversed[firstUnreadIdx].timestamp);
          const timeStr = firstUnreadTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          setUnreadInfo({ count: unreadCount, since: timeStr });
          bannerModeRef.current = "catchup";
          wasNearBottomRef.current = false;

          // Policy #4: Scroll to divider, not bottom
          requestAnimationFrame(() => {
            if (cancelled) return;
            isProgrammaticScrollRef.current = true;
            if (dividerRef.current) {
              dividerRef.current.scrollIntoView({ behavior: "instant", block: "start" });
            } else {
              // Fallback: if divider not rendered yet, scroll to bottom
              bottomRef.current?.scrollIntoView({ behavior: "instant" });
            }
            setShowBanner(true);
            // Mark as loaded after programmatic scroll completes
            requestAnimationFrame(() => { isLoadedRef.current = true; });
          });
        } else {
          // openReadId exists but all messages are read → scroll to bottom
          requestAnimationFrame(() => {
            if (cancelled) return;
            isProgrammaticScrollRef.current = true;
            bottomRef.current?.scrollIntoView({ behavior: "instant" });
            requestAnimationFrame(() => { isLoadedRef.current = true; });
          });
        }
      } else {
        // Policy #1: No unread → scroll to bottom
        requestAnimationFrame(() => {
          if (cancelled) return;
          isProgrammaticScrollRef.current = true;
          bottomRef.current?.scrollIntoView({ behavior: "instant" });
          requestAnimationFrame(() => { isLoadedRef.current = true; });
        });
      }
    }).catch((err) => console.error("loadMessages:", err));

    return () => { cancelled = true; };
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
      // If content doesn't overflow, don't auto-clear (only Mark as Read works)
      if (container.scrollHeight <= container.clientHeight) return;

      wasNearBottomRef.current = isNearBottom(container);

      // Policy #6: User manually scrolled to bottom → clear unread state
      if (wasNearBottomRef.current) {
        const store = useReadStateStore.getState();
        const hasOpenSnapshot = !!store.channelOpenReadIds[channelId];
        if (showBannerRef.current || hasOpenSnapshot) {
          setShowBanner(false);
          setUnreadInfo(null);
          store.clearChannelOpenSnapshot(channelId);
          // Ack the last message
          const currentMessages = useMessageStore.getState().messages[channelId];
          if (currentMessages && currentMessages.length > 0) {
            const lastMessage = currentMessages[currentMessages.length - 1];
            lastAckedIds.set(channelId, lastMessage.id);
            store.clearUnread(channelId);
            api.ackMessage(channelId, lastMessage.id).catch(() => {});
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
        // User sent a message → clear all unread state + scroll to bottom
        setShowBanner(false);
        setUnreadInfo(null);
        useReadStateStore.getState().clearChannelOpenSnapshot(channelId);
        useReadStateStore.getState().clearUnread(channelId);
        if (lastMsg.id !== lastAckedIds.get(channelId)) {
          lastAckedIds.set(channelId, lastMsg.id);
          api.ackMessage(channelId, lastMsg.id).catch(() => {});
        }
        requestAnimationFrame(() => scrollToBottom());
      } else if (wasNearBottomRef.current) {
        // Policy #2: User at bottom + new message from others → keep at bottom
        requestAnimationFrame(() => scrollToBottom());
      } else {
        // Policy #5: User scrolled up + new message from others → show/update banner
        const newCount = messages.length - prevCountRef.current;
        bannerModeRef.current = "live";
        setUnreadInfo((prev) => {
          const count = (prev?.count ?? 0) + newCount;
          const firstNewMsg = messages[messages.length - newCount];
          const since = prev?.since ?? new Date(firstNewMsg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return { count, since };
        });
        setShowBanner(true);
      }
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

  // Banner click: scroll to bottom (live mode) or divider (catchup mode)
  const handleBannerClick = useCallback(() => {
    if (bannerModeRef.current === "live") {
      scrollToBottom();
    } else {
      scrollToDivider();
    }
    setShowBanner(false);
    setUnreadInfo(null);
  }, [scrollToBottom, scrollToDivider]);

  // Policy #7: Mark as Read button — clear everything + ack
  const handleMarkAsRead = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowBanner(false);
    setUnreadInfo(null);
    useReadStateStore.getState().clearChannelOpenSnapshot(channelId);

    const currentMessages = useMessageStore.getState().messages[channelId];
    if (currentMessages && currentMessages.length > 0) {
      const lastMessage = currentMessages[currentMessages.length - 1];
      lastAckedIds.set(channelId, lastMessage.id);
      useReadStateStore.getState().clearUnread(channelId);
      api.ackMessage(channelId, lastMessage.id).catch(() => {});
    }
  }, [channelId]);

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

  const bannerArrow = bannerModeRef.current === "live" ? "↓" : "↑";
  const bannerText = bannerModeRef.current === "live"
    ? `${bannerArrow} ${unreadInfo?.count ?? 0} new message${(unreadInfo?.count ?? 0) !== 1 ? "s" : ""}`
    : `${bannerArrow} ${unreadInfo?.count ?? 0} new message${(unreadInfo?.count ?? 0) !== 1 ? "s" : ""} since ${unreadInfo?.since ?? ""} — Jump`;

  return (
    <>
      {showBanner && unreadInfo && (
        <div style={bannerWrapperStyle}>
          <div style={bannerStyle} onClick={handleBannerClick} role="button" tabIndex={0}>
            <span>{bannerText}</span>
            <button style={bannerDismissStyle} onClick={handleMarkAsRead}>Mark as Read</button>
          </div>
        </div>
      )}
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
