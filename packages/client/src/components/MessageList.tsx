import { useEffect, useRef, useCallback, useState, useMemo, Fragment } from "react";
import { useMessageStore } from "../stores/useMessageStore";
import { useReadStateStore } from "../stores/useReadStateStore";
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

  // Fix #1: Store auto-hide timer to prevent leaks / cross-channel pollution
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fix #3: Track banner mode for click direction
  const bannerModeRef = useRef<BannerMode>("catchup");

  // Fix #4: Guard against initial programmatic scroll hiding banner
  const isInitialScrollRef = useRef(false);

  // Fix #8: Use ref for showBanner so scroll handler doesn't cause re-bind
  const showBannerRef = useRef(false);
  showBannerRef.current = showBanner;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  const scrollToDivider = useCallback(() => {
    dividerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Snapshot read state when opening a channel
  useEffect(() => {
    const store = useReadStateStore.getState();
    // Only snapshot if the channel is actually unread
    if (store.unreadChannels[channelId]) {
      store.snapshotChannelOpen(channelId);
    }
    return () => {
      // Clear snapshot on unmount
      useReadStateStore.getState().clearChannelOpenSnapshot(channelId);
    };
  }, [channelId]);

  useEffect(() => {
    let cancelled = false;
    prevCountRef.current = 0;
    wasNearBottomRef.current = true;
    setShowBanner(false);
    setUnreadInfo(null);
    bannerModeRef.current = "catchup";

    // Fix #1: Clear any pending auto-hide timer on channel switch
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }

    api.fetchMessages(channelId).then((msgs) => {
      if (!cancelled) {
        const reversed = msgs.reverse();
        setMessages(channelId, reversed);
        prevCountRef.current = reversed.length;

        // Calculate unread info for banner
        const openReadId = useReadStateStore.getState().channelOpenReadIds[channelId];
        if (openReadId) {
          const firstUnreadIdx = reversed.findIndex((m) => m.id > openReadId);
          if (firstUnreadIdx !== -1) {
            const unreadCount = reversed.length - firstUnreadIdx;
            const firstUnreadTime = new Date(reversed[firstUnreadIdx].timestamp);
            const timeStr = firstUnreadTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            setUnreadInfo({ count: unreadCount, since: timeStr });
            bannerModeRef.current = "catchup";
            // Fix #4: Set initial scroll guard before scrolling
            isInitialScrollRef.current = true;
            requestAnimationFrame(() => {
              scrollToBottom("instant");
              setShowBanner(true);
              // Fix #1: Store timer ref and clear before setting new one
              if (autoHideTimerRef.current) {
                clearTimeout(autoHideTimerRef.current);
              }
              autoHideTimerRef.current = setTimeout(() => {
                if (wasNearBottomRef.current) {
                  setShowBanner(false);
                  setUnreadInfo(null);
                  // Clear the NEW divider and ack on auto-hide at bottom
                  useReadStateStore.getState().clearChannelOpenSnapshot(channelId);
                  const currentMessages = useMessageStore.getState().messages[channelId];
                  if (currentMessages && currentMessages.length > 0) {
                    const lastMessage = currentMessages[currentMessages.length - 1];
                    lastAckedIds.set(channelId, lastMessage.id);
                    useReadStateStore.getState().clearUnread(channelId);
                    api.ackMessage(channelId, lastMessage.id).catch(() => {});
                  }
                }
                autoHideTimerRef.current = null;
              }, 5000);
            });
          } else {
            requestAnimationFrame(() => scrollToBottom("instant"));
          }
        } else {
          requestAnimationFrame(() => scrollToBottom("instant"));
        }

        // Auto-ack DEFERRED: Do NOT ack on initial channel open.
        // Ack happens when: user clicks Mark as Read, scrolls to bottom, or auto-hide timer fires at bottom.
      }
    }).catch((err) => console.error("loadMessages:", err));
    return () => {
      cancelled = true;
      // Fix #1: Cleanup timer on unmount / channel change
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = null;
      }
    };
  }, [channelId, setMessages, scrollToBottom]);

  // Fix #8: Bind scroll listener only once per channel (no showBanner in deps)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      // Fix #4: Skip the first programmatic scroll event
      if (isInitialScrollRef.current) {
        isInitialScrollRef.current = false;
        return;
      }
      wasNearBottomRef.current = isNearBottom(container);
      // Fix #6: If user scrolled to bottom, hide banner, clear unreadInfo, clear divider, and ack
      if (wasNearBottomRef.current && showBannerRef.current) {
        setShowBanner(false);
        setUnreadInfo(null);
        // Clear the NEW divider snapshot
        useReadStateStore.getState().clearChannelOpenSnapshot(channelId);
        // Ack the last message
        const currentMessages = useMessageStore.getState().messages[channelId];
        if (currentMessages && currentMessages.length > 0) {
          const lastMessage = currentMessages[currentMessages.length - 1];
          lastAckedIds.set(channelId, lastMessage.id);
          useReadStateStore.getState().clearUnread(channelId);
          api.ackMessage(channelId, lastMessage.id).catch(() => {});
        }
      }
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [channelId]);

  // New message added → scroll if was near bottom, or show banner
  useEffect(() => {
    if (!messages) return;
    if (messages.length > prevCountRef.current) {
      if (wasNearBottomRef.current) {
        requestAnimationFrame(() => scrollToBottom());
      } else {
        // User is scrolled up, new messages arrived — update banner with live mode
        const newCount = messages.length - prevCountRef.current;
        // Fix #3: Set mode to 'live' for new arrivals while scrolled up
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
  }, [messages?.length, scrollToBottom]);

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

  // Fix #3: Banner click scrolls based on mode
  const handleBannerClick = useCallback(() => {
    if (bannerModeRef.current === "live") {
      scrollToBottom();
    } else {
      scrollToDivider();
    }
    setShowBanner(false);
    // Fix #6: Reset unreadInfo on banner click
    setUnreadInfo(null);
  }, [scrollToBottom, scrollToDivider]);

  // Fix #2: handleMarkAsRead now calls api.ackMessage
  const handleMarkAsRead = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowBanner(false);
    setUnreadInfo(null);
    useReadStateStore.getState().clearChannelOpenSnapshot(channelId);

    // Fix #2: Ack the last message on the server
    const currentMessages = useMessageStore.getState().messages[channelId];
    if (currentMessages && currentMessages.length > 0) {
      const lastMessage = currentMessages[currentMessages.length - 1];
      lastAckedIds.set(channelId, lastMessage.id);
      useReadStateStore.getState().clearUnread(channelId);
      api.ackMessage(channelId, lastMessage.id).catch(() => {});
    }
  }, [channelId]);

  // Fix #7: Memoize divider index (must be before early returns to satisfy hooks rules)
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
        <Empty image="🌊" imageStyle={{ fontSize: 48, lineHeight: "56px" /* decorative one-off */ }} description="No messages yet — be the first!" />
      </div>
    );
  }

  // Fix #3: Build banner text based on mode
  const bannerArrow = bannerModeRef.current === "live" ? "↓" : "↑";
  const bannerText = bannerModeRef.current === "live"
    ? `${bannerArrow} ${unreadInfo?.count ?? 0} new message${(unreadInfo?.count ?? 0) !== 1 ? "s" : ""}`
    : `${bannerArrow} ${unreadInfo?.count ?? 0} new message${(unreadInfo?.count ?? 0) !== 1 ? "s" : ""} since ${unreadInfo?.since ?? ""} — Jump`;

  return (
    <>
      <div ref={scrollContainerRef} style={listStyle} className="scroll-container">
        {/* Fix #5: Use Fragment instead of wrapper div */}
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
      {showBanner && unreadInfo && (
        <div style={bannerWrapperStyle}>
          <div style={bannerStyle} onClick={handleBannerClick} role="button" tabIndex={0}>
            <span>{bannerText}</span>
            <button style={bannerDismissStyle} onClick={handleMarkAsRead}>Mark as Read</button>
          </div>
        </div>
      )}
      <TypingIndicator channelId={channelId} />
    </>
  );
}
