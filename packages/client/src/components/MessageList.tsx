import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import { useMessageStore } from "../stores/useMessageStore";
import { useReadStateStore } from "../stores/useReadStateStore";
import { useUserStore } from "../stores/useUserStore";
import { MessageItem } from "./MessageItem";
import { LazyMessageItem } from "./LazyMessageItem";
import { TypingIndicator } from "./TypingIndicator";
import { MessageContextMenu } from "./MessageContextMenu";
import { Spin, Empty } from "antd";
import * as api from "../lib/api";
import type { CSSProperties } from "react";
import type { Message } from "../types";

/* ══════════════════════════════════════════════════════════════════════════
 * SCROLL ARCHITECTURE
 *
 * Goal: match Discord's scroll behaviour exactly — no flash, no jump,
 * position restored on channel switch.
 *
 * Key insight: the same <MessageList> *instance* is reused when
 * `channelId` prop changes (React does NOT unmount/remount). The scroll
 * container DOM element persists, so its scrollTop carries over between
 * channels unless we explicitly manage it.
 *
 * Module-level Maps survive across renders & re-mounts:
 *   scrollMemory    – saved { distanceFromBottom, wasAtBottom } per channel
 *   lastFetchTime   – when we last fetched, for staleness checks
 *   lastAckedIds    – dedup ack API calls
 *
 * We store **distance from bottom** rather than scrollTop because the
 * bottom 30 messages render eagerly (constant height), while older
 * messages use lazy placeholders whose heights may differ from their
 * fully-rendered form. Distance-from-bottom is stable regardless of
 * placeholder compression above the viewport.
 *
 * Channel-switch flow (A → B, both previously visited):
 *   1. Scroll listener (effect #2) continuously saves A's position
 *      into scrollMemory on every scroll event — this is the
 *      authoritative source.
 *   2. React renders B's cached messages (DOM changes)
 *   3. useLayoutEffect setup    – restores B's position (before paint)
 *   4. Browser paints           – user sees correct position, no flash
 *   5. useEffect cleanup/setup  – swaps scroll listener
 *
 * Important: the useLayoutEffect cleanup does NOT save scroll position.
 * By the time cleanup runs, React has already committed the new channel's
 * DOM, so container.scrollTop no longer reflects the old channel's
 * position. The scroll listener is the sole writer to scrollMemory.
 *
 * A `restoringRef` flag suppresses the scroll listener during
 * programmatic position changes so we don't accidentally overwrite the
 * saved position with an intermediate value.
 * ══════════════════════════════════════════════════════════════════════ */

// ── Styles ──────────────────────────────────────────────────────────────
const centerStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const listStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  scrollbarGutter: "stable" as any,
  paddingTop: "var(--space-sm)",
  paddingBottom: 0,
  paddingLeft: 0,
  paddingRight: 0,
  display: "flex",
  flexDirection: "column",
  WebkitOverflowScrolling: "touch",
  overscrollBehavior: "contain",
};

// ── Constants ───────────────────────────────────────────────────────────
const NEAR_BOTTOM_THRESHOLD = 100;
/** Distance from top that triggers loading older messages. */
const NEAR_TOP_THRESHOLD = 200;
/** Bottom N messages render eagerly; older ones use lazy placeholders. */
const EAGER_COUNT = 30;
/** Cached messages older than this trigger a background refetch. */
const STALE_MS = 5 * 60 * 1000; // 5 min
/** Number of messages per page fetch. */
const PAGE_SIZE = 50;

// ── Module-level persistent state ───────────────────────────────────────
/** Scroll memory per channel. Uses distance-from-bottom for stability. */
const scrollMemory = new Map<
  string,
  { distanceFromBottom: number; wasAtBottom: boolean }
>();
/** Last fetch time per channel for staleness checks. */
const lastFetchTime = new Map<string, number>();
/** Last acked message ID per channel to skip redundant ack calls. */
const lastAckedIds = new Map<string, string>();
/** Whether there are more older messages to load per channel. */
const hasMoreHistory = new Map<string, boolean>();
/** Whether we're currently fetching older messages per channel. */
const fetchingOlder = new Map<string, boolean>();

// ── Bounded map/set helpers ─────────────────────────────────────────────
const MAP_CAP = 100;
const MAP_EVICT = 20;

function evictOldest<K, V>(map: Map<K, V>, count: number): void {
  const iter = map.keys();
  for (let i = 0; i < count; i++) {
    const { value, done } = iter.next();
    if (done) break;
    map.delete(value);
  }
}

function cappedMapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  if (map.size > MAP_CAP) evictOldest(map, MAP_EVICT);
}

// ── Helpers ─────────────────────────────────────────────────────────────
function isNearBottom(el: HTMLElement): boolean {
  return (
    el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD
  );
}

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

function scrollToBottomImmediate(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
}

function restoreDistanceFromBottom(el: HTMLElement, dist: number): void {
  el.scrollTop = el.scrollHeight - dist - el.clientHeight;
}

// ── Component ───────────────────────────────────────────────────────────
export function MessageList({ channelId }: { channelId: string }) {
  const messages = useMessageStore((s) => s.messages[channelId]);
  const setMessages = useMessageStore((s) => s.setMessages);
  const prependMessages = useMessageStore((s) => s.prependMessages);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const scrollContainerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    setScrollRoot(node);
  }, []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** Whether there are more older messages; drives the 'beginning' indicator. */
  const [hasMore, setHasMore] = useState(true);
  const currentUserId = useUserStore((s) => s.id);
  const pendingStatus = useMessageStore((s) => s.pendingStatus);
  const getLastReadId = useReadStateStore((s) => s.getLastReadId);

  // ── Unread indicators (per confirmed spec) ─────────────────────
  // Snapshot the last-read ID on channel entry — frozen, never changes
  const lastReadIdSnapshotRef = useRef<string | undefined>(undefined);
  // Whether the unread count has been computed for this channel entry
  const unreadComputedForRef = useRef<string | null>(null);
  // Entry indicators (frozen on channel entry)
  const [showNewLine, setShowNewLine] = useState(false);
  const [entryUnreadCount, setEntryUnreadCount] = useState(0);
  const [showTopBanner, setShowTopBanner] = useState(false);
  // Real-time indicator: bottom pill for messages arriving while scrolled up
  const [newMessagesBelowCount, setNewMessagesBelowCount] = useState(0);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: Message } | null>(null);
  const handleContextMenu = useCallback((e: React.MouseEvent, message: Message) => {
    // Don't show menu for pending messages
    if (pendingStatus[message.id]) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, message });
  }, [pendingStatus]);

  /** Always reflects the current channelId so the scroll handler is never stale. */
  const channelIdRef = useRef(channelId);
  useLayoutEffect(() => {
    channelIdRef.current = channelId;
    // Reset hasMore for the new channel from module-level cache
    setHasMore(hasMoreHistory.get(channelId) !== false);
    // Reset firstMessageIdRef so effect #5 doesn't misdetect a prepend
    firstMessageIdRef.current = undefined;
    // Sync loadingOlder with the new channel's actual fetch state
    setLoadingOlder(fetchingOlder.get(channelId) === true);
    // Clear any pending prepend scroll restore from the old channel
    pendingPrependRestoreRef.current = null;
    // Snapshot the last-read ID for the NEW separator
    const lastReadId = getLastReadId(channelId);
    lastReadIdSnapshotRef.current = lastReadId;
    // Reset all unread indicators for fresh computation
    setShowNewLine(false);
    setEntryUnreadCount(0);
    setShowTopBanner(false);
    setNewMessagesBelowCount(0);
    unreadComputedForRef.current = null;
  }, [channelId, getLastReadId]);

  // Compute unread count ONCE when messages first load for this channel.
  useEffect(() => {
    if (unreadComputedForRef.current === channelId) return;
    if (!messages?.length) return;

    const lastReadId = lastReadIdSnapshotRef.current;
    if (!lastReadId) {
      // No read cursor — channel never visited, all messages are unread
      setEntryUnreadCount(messages.length);
      setShowNewLine(true);
      setShowTopBanner(true);
      unreadComputedForRef.current = channelId;
      return;
    }

    const lastReadIdx = messages.findIndex((m) => m.id === lastReadId);
    if (lastReadIdx === -1) {
      // lastReadId not in loaded messages — all visible are unread
      setEntryUnreadCount(messages.length);
      setShowNewLine(true);
      setShowTopBanner(true);
      unreadComputedForRef.current = channelId;
      return;
    }

    if (lastReadIdx === messages.length - 1) {
      // Last read is the latest message — no unread
      setEntryUnreadCount(0);
      setShowNewLine(false);
      setShowTopBanner(false);
      unreadComputedForRef.current = channelId;
      return;
    }

    const count = messages.length - lastReadIdx - 1;
    setEntryUnreadCount(count);
    setShowNewLine(true);
    setShowTopBanner(true);
    unreadComputedForRef.current = channelId;
  }, [channelId, messages]);

  /** Previous message count — used to detect newly-added messages. */
  const prevCountRef = useRef(0);
  /** Whether the user was near the bottom on the last scroll event. */
  const wasNearBottomRef = useRef(true);
  /** Suppresses scroll-save during programmatic position changes. */
  const restoringRef = useRef(false);
  /** Set after a fresh fetch; the next layout effect scrolls to bottom. */
  const pendingScrollToBottomRef = useRef(false);
  /** Tracks the first message id to distinguish prepend from append in effect #5. */
  const firstMessageIdRef = useRef<string | undefined>(undefined);
  /** Pending scroll restore after prepend — stores prevScrollHeight. */
  const pendingPrependRestoreRef = useRef<number | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  /** Scroll to and briefly highlight a specific message (for reply jump). */
  const handleJumpToMessage = useCallback((messageId: string) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    // Find the message element by data attribute
    const el = container.querySelector(`[data-message-id="${messageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("message-highlight");
      setTimeout(() => el.classList.remove("message-highlight"), 2000);
    }
  }, []);

  // ── 1. Restore scroll position on channel switch ──────────────────
  //
  // Setup restores the INCOMING channel's scroll position from
  // scrollMemory (which the scroll listener keeps up-to-date).
  // Cleanup intentionally does NOT save — by the time it runs, the DOM
  // already contains the new channel's content, so scrollTop is stale.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;

    // ── Restore incoming channel ──
    if (container && messages && messages.length > 0) {
      const mem = scrollMemory.get(channelId);
      restoringRef.current = true;

      if (!mem || mem.wasAtBottom) {
        scrollToBottomImmediate(container);
        wasNearBottomRef.current = true;
      } else {
        restoreDistanceFromBottom(container, mem.distanceFromBottom);
        wasNearBottomRef.current = false;
      }

      // Clear the flag after the browser processes the programmatic scroll.
      requestAnimationFrame(() => {
        restoringRef.current = false;
      });
    }

    prevCountRef.current = messages?.length ?? 0;

    // No cleanup — scroll listener (effect #2) is the sole authority
    // for saving scroll position into scrollMemory.

    // We intentionally depend only on channelId. `messages` is accessed
    // from the closure of the render that triggered this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // ── 2. Scroll listener — continuously tracks position ─────────────
  const hasMessages = !!messages && messages.length > 0;
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const onScroll = () => {
      if (restoringRef.current) {
        return;
      }
      const id = channelIdRef.current;
      const atBottom = isNearBottom(container);
      wasNearBottomRef.current = atBottom;

      // Per spec: scrolling to bottom clears top banner and bottom pill
      if (atBottom) {
        setShowTopBanner(false);
        setNewMessagesBelowCount(0);
      }
      const dist = distanceFromBottom(container);
      cappedMapSet(scrollMemory, id, {
        distanceFromBottom: dist,
        wasAtBottom: atBottom,
      });

      // ── Load older messages when near top ──
      if (
        container.scrollTop <= NEAR_TOP_THRESHOLD &&
        hasMoreHistory.get(id) !== false &&
        !fetchingOlder.get(id)
      ) {
        const msgs = useMessageStore.getState().messages[id];
        const oldest = msgs?.[0];
        if (oldest && !oldest.id.startsWith("pending-")) {
          cappedMapSet(fetchingOlder, id, true);
          setLoadingOlder(true);
          api
            .fetchMessages(id, { before: oldest.id, limit: PAGE_SIZE })
            .then((fetched) => {
              // Guard: if user switched channels, discard stale results
              if (channelIdRef.current !== id) return;
              // API returns newest-first, reverse to chronological
              const older = [...fetched].reverse();
              if (older.length < PAGE_SIZE) {
                cappedMapSet(hasMoreHistory, id, false);
                setHasMore(false);
              }
              if (older.length > 0) {
                // Save scrollHeight before prepend; restore in useLayoutEffect
                pendingPrependRestoreRef.current = container.scrollHeight;
                prependMessages(id, older);
              }
            })
            .catch((err) => console.error("loadOlder:", err))
            .finally(() => {
              cappedMapSet(fetchingOlder, id, false);
              // Only update React state if still on the same channel
              if (channelIdRef.current === id) {
                setLoadingOlder(false);
              }
            });
        }
      }
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [channelId, hasMessages]);

  // ── 3. Fetch messages — skip if cached & fresh ────────────────────
  useEffect(() => {
    let cancelled = false;
    const cachedMessages = useMessageStore.getState().messages[channelId];
    const hasCached = cachedMessages && cachedMessages.length > 0;
    const fetchTime = lastFetchTime.get(channelId);
    const isStale = !fetchTime || Date.now() - fetchTime > STALE_MS;

    if (hasCached && !isStale) {
      // Fresh cache — just ack the last message if needed
      const lastMsg = cachedMessages[cachedMessages.length - 1];
      if (
        lastMsg &&
        lastMsg.id !== lastAckedIds.get(channelId) &&
        !lastMsg.id.startsWith("pending-")
      ) {
        cappedMapSet(lastAckedIds, channelId, lastMsg.id);
        useReadStateStore.getState().clearUnread(channelId);
        api.ackMessage(channelId, lastMsg.id).catch(() => {});
      }
      return;
    }

    // Need to fetch from API
    wasNearBottomRef.current = true;
    api
      .fetchMessages(channelId)
      .then((msgs) => {
        if (cancelled) return;
        const reversed = msgs.reverse();
        setMessages(channelId, reversed);
        cappedMapSet(lastFetchTime, channelId, Date.now());
        prevCountRef.current = reversed.length;
        // If we got fewer than PAGE_SIZE, there's no more history
        cappedMapSet(hasMoreHistory, channelId, reversed.length >= PAGE_SIZE);
        setHasMore(reversed.length >= PAGE_SIZE);

        // Only scroll-to-bottom on truly uncached first loads.
        // For stale refetches, honour the user's saved position.
        const mem = scrollMemory.get(channelId);
        if (!mem || mem.wasAtBottom) {
          pendingScrollToBottomRef.current = true;
        }

        // Auto-ack last message
        if (reversed.length > 0) {
          const lastMsg = reversed[reversed.length - 1];
          if (
            lastMsg.id !== lastAckedIds.get(channelId) &&
            !lastMsg.id.startsWith("pending-")
          ) {
            cappedMapSet(lastAckedIds, channelId, lastMsg.id);
            useReadStateStore.getState().clearUnread(channelId);
            api.ackMessage(channelId, lastMsg.id).catch(() => {});
          }
        }
      })
      .catch((err) => console.error("loadMessages:", err));

    return () => {
      cancelled = true;
    };
  }, [channelId, setMessages]);

  // ── 4. After fresh-fetch render → scroll to bottom ────────────────
  // Runs on every render (no deps) so it catches the first render after
  // setMessages fires. useLayoutEffect guarantees this runs before paint.
  useLayoutEffect(() => {
    if (!pendingScrollToBottomRef.current) return;
    pendingScrollToBottomRef.current = false;
    const container = scrollContainerRef.current;
    if (container) {
      restoringRef.current = true;
      scrollToBottomImmediate(container);
      requestAnimationFrame(() => {
        restoringRef.current = false;
      });
    }
  });

  // ── 4b. After prepend render → restore scroll position ────────────
  // useLayoutEffect runs after React commits DOM but before paint,
  // so scrollHeight is accurate (avoids React 18 batching issues with rAF).
  useLayoutEffect(() => {
    const prevHeight = pendingPrependRestoreRef.current;
    if (prevHeight === null) return;
    pendingPrependRestoreRef.current = null;
    const container = scrollContainerRef.current;
    if (container) {
      const delta = container.scrollHeight - prevHeight;
      if (delta === 0) return;
      restoringRef.current = true;
      container.scrollTop += delta;
      requestAnimationFrame(() => {
        restoringRef.current = false;
      });
    }
  });

  // ── 5. New message → auto-scroll if user was at bottom ────────────
  //
  // Own messages (optimistic pending-* ids) ALWAYS trigger scroll-to-bottom
  // so the user sees their own message immediately, even if they had
  // scrolled up. Other people's messages only scroll if we were already
  // near the bottom.
  //
  // Prepend (loading older messages) is detected by a change in the first
  // message id — in that case we skip auto-scroll since position is
  // restored by effect 4b above.
  useEffect(() => {
    if (!messages) return;
    const firstId = messages[0]?.id;
    const wasPrepend = firstId !== firstMessageIdRef.current && firstMessageIdRef.current !== undefined;
    firstMessageIdRef.current = firstId;

    if (messages.length > prevCountRef.current && !wasPrepend) {
      const lastMsg = messages[messages.length - 1];
      const isOwnMessage = lastMsg && lastMsg.id.startsWith("pending-");
      if (isOwnMessage) {
        // Per spec: sending a message clears the NEW line
        setShowNewLine(false);
      }
      if (isOwnMessage || wasNearBottomRef.current) {
        requestAnimationFrame(() => scrollToBottom());
        wasNearBottomRef.current = true;
      } else {
        // User is scrolled up and a new message arrived — show bottom pill
        setNewMessagesBelowCount((c) => c + 1);
      }
    }
    prevCountRef.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages?.length, scrollToBottom]);

  // ── 6. Last message content edit → stay at bottom ─────────────────
  const lastMessageContent = messages?.[messages.length - 1]?.content;
  useEffect(() => {
    if (!messages || !wasNearBottomRef.current) return;
    requestAnimationFrame(() => scrollToBottom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessageContent, scrollToBottom]);

  // ── 7. Reaction on last message → stay at bottom ──────────────────
  const lastMsg = messages?.[messages.length - 1];
  const lastMsgReactionKey = lastMsg
    ? `${lastMsg.id}:${(lastMsg.reactions ?? []).reduce((s, r) => s + r.count, 0)}`
    : "";
  useEffect(() => {
    if (!messages || !lastMsgReactionKey || !wasNearBottomRef.current) return;
    requestAnimationFrame(() => scrollToBottom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMsgReactionKey, scrollToBottom]);

  // ── Render ────────────────────────────────────────────────────────
  if (!messages) {
    return (
      <div style={centerStyle}>
        <Spin tip="Loading messages…" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div style={centerStyle}>
        <Empty
          image="🌊"
          imageStyle={{ fontSize: 48, lineHeight: "56px" }}
          description="No messages yet — be the first!"
        />
      </div>
    );
  }

  return (
    <>
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {loadingOlder && (
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, zIndex: 1,
            display: "flex", justifyContent: "center", padding: "var(--space-sm) 0",
            background: "linear-gradient(var(--bg-primary), transparent)",
          }}>
            <Spin size="small" />
          </div>
        )}
        {showTopBanner && entryUnreadCount > 0 && (
          <div
            style={{
              position: "absolute", top: 0, left: 0, right: 0, zIndex: 2,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "var(--space-xs) var(--content-pad)",
              background: "var(--accent, #5865f2)", color: "#fff",
              fontSize: "var(--font-size-sm)", fontWeight: 500,
            }}
          >
            <span>{entryUnreadCount}{entryUnreadCount >= (messages?.length ?? 0) ? "+" : ""} new {entryUnreadCount === 1 ? "message" : "messages"}</span>
            <span
              style={{ fontWeight: 600, cursor: "pointer", padding: "0 var(--space-xs)" }}
              onClick={() => {
                // Ack the latest message to clear unread state
                if (messages?.length) {
                  const lastMsg = messages[messages.length - 1];
                  if (lastMsg && !lastMsg.id.startsWith("pending-")) {
                    useReadStateStore.getState().markRead(channelId, lastMsg.id);
                    api.ackMessage(channelId, lastMsg.id).catch(() => {});
                  }
                }
                scrollToBottom();
                setShowTopBanner(false);
                setShowNewLine(false);
              }}
            >Mark as Read</span>
          </div>
        )}
        <div
          ref={scrollContainerCallbackRef}
          style={listStyle}
          className="scroll-container"
        >
          {!hasMore && messages.length > 0 && (
            <div style={{ textAlign: "center", padding: "var(--space-sm) 0", color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
              This is the beginning of the conversation
            </div>
          )}
          {(() => {
          const lastReadId = lastReadIdSnapshotRef.current;
          const lastReadIdInMessages = lastReadId ? messages.some((m) => m.id === lastReadId) : false;
          return messages.map((msg, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const isGroupStart =
            !prev ||
            prev.author.id !== msg.author.id ||
              Date.parse(msg.timestamp) - Date.parse(prev.timestamp) >
                7 * 60 * 1000;
            const eager = i >= messages.length - EAGER_COUNT;

            // NEW separator logic:
            // Case A: lastReadId is in loaded messages → show between lastReadId and next msg
            // Case B: lastReadId is NOT in loaded messages (too old) → show before first message
            // Case C: lastReadId is null (never visited) → show before first message
            const isFirstUnread = showNewLine && (
              (lastReadId && lastReadIdInMessages && prev && prev.id === lastReadId) ||
              (i === 0 && (!lastReadId || !lastReadIdInMessages))
            );

            return (
              <div key={msg.id}>
                {isFirstUnread && (
                  <div style={{ display: "flex", alignItems: "center", padding: "var(--space-xs) var(--content-pad)", gap: "var(--space-sm)" }} data-new-separator>
                    <div style={{ flex: 1, height: 1, background: "var(--status-danger, #ed4245)" }} />
                    <span style={{ color: "var(--status-danger, #ed4245)", fontSize: "var(--font-size-xs)", fontWeight: 700, textTransform: "uppercase", flexShrink: 0 }}>New</span>
                  </div>
                )}
                <LazyMessageItem
                  messageId={msg.id}
                  eager={eager}
                  scrollRoot={scrollRoot}
                >
                  <MessageItem message={msg} isGroupStart={isGroupStart} onJumpToMessage={handleJumpToMessage} onContextMenu={handleContextMenu} />
                </LazyMessageItem>
              </div>
            );
          });
          })()}
        <div ref={bottomRef} />
        </div>
        {newMessagesBelowCount > 0 && (
          <div
            style={{
              position: "absolute", bottom: 48, left: "50%", transform: "translateX(-50%)", zIndex: 2,
              background: "var(--accent, #5865f2)", color: "#fff",
              borderRadius: 20, padding: "var(--space-xs) var(--space-md)",
              fontSize: "var(--font-size-sm)", fontWeight: 500,
              cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            }}
            onClick={() => {
              scrollToBottom();
              setNewMessagesBelowCount(0);
            }}
          >
            {newMessagesBelowCount} new {newMessagesBelowCount === 1 ? "message" : "messages"} ↓
          </div>
        )}
      </div>
      <TypingIndicator channelId={channelId} />
      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          messageId={contextMenu.message.id}
          channelId={channelId}
          content={contextMenu.message.content}
          isOwnMessage={contextMenu.message.author.id === currentUserId}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
