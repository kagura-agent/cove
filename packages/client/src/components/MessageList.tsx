import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import { useMessageStore } from "../stores/useMessageStore";
import { useReadStateStore } from "../stores/useReadStateStore";
import { MessageItem } from "./MessageItem";
import { LazyMessageItem } from "./LazyMessageItem";
import { TypingIndicator } from "./TypingIndicator";
import { Spin, Empty } from "antd";
import * as api from "../lib/api";
import type { CSSProperties } from "react";

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
/** Bottom N messages render eagerly; older ones use lazy placeholders. */
const EAGER_COUNT = 30;
/** Cached messages older than this trigger a background refetch. */
const STALE_MS = 5 * 60 * 1000; // 5 min

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

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const scrollContainerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    setScrollRoot(node);
  }, []);
  const bottomRef = useRef<HTMLDivElement>(null);

  /** Always reflects the current channelId so the scroll handler is never stale. */
  const channelIdRef = useRef(channelId);
  useLayoutEffect(() => {
    channelIdRef.current = channelId;
  }, [channelId]);

  /** Previous message count — used to detect newly-added messages. */
  const prevCountRef = useRef(0);
  /** Whether the user was near the bottom on the last scroll event. */
  const wasNearBottomRef = useRef(true);
  /** Suppresses scroll-save during programmatic position changes. */
  const restoringRef = useRef(false);
  /** Set after a fresh fetch; the next layout effect scrolls to bottom. */
  const pendingScrollToBottomRef = useRef(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
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
      const dist = distanceFromBottom(container);
      cappedMapSet(scrollMemory, id, {
        distanceFromBottom: dist,
        wasAtBottom: atBottom,
      });
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

  // ── 5. New message → auto-scroll if user was at bottom ────────────
  //
  // Own messages (optimistic pending-* ids) ALWAYS trigger scroll-to-bottom
  // so the user sees their own message immediately, even if they had
  // scrolled up. Other people's messages only scroll if we were already
  // near the bottom.
  useEffect(() => {
    if (!messages) return;
    if (messages.length > prevCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      const isOwnMessage = lastMsg && lastMsg.id.startsWith("pending-");
      if (isOwnMessage || wasNearBottomRef.current) {
        requestAnimationFrame(() => scrollToBottom());
        // After scrolling for own message, mark as near-bottom so
        // subsequent messages from others also auto-scroll.
        wasNearBottomRef.current = true;
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
      <div
        ref={scrollContainerCallbackRef}
        style={listStyle}
        className="scroll-container"
      >
        {messages.map((msg, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const isGroupStart =
            !prev ||
            prev.author.id !== msg.author.id ||
              Date.parse(msg.timestamp) - Date.parse(prev.timestamp) >
                7 * 60 * 1000;
            const eager = i >= messages.length - EAGER_COUNT;
            return (
              <LazyMessageItem
                key={msg.id}
                messageId={msg.id}
                eager={eager}
                scrollRoot={scrollRoot}
              >
                <MessageItem message={msg} isGroupStart={isGroupStart} />
              </LazyMessageItem>
            );
          })}
        <div ref={bottomRef} />
      </div>
      <TypingIndicator channelId={channelId} />
    </>
  );
}
