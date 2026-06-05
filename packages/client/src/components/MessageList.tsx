import { useEffect, useRef, useMemo, useCallback } from "react";
import { useMessageStore } from "../stores/useMessageStore";
import { useTypingStore } from "../stores/useTypingStore";
import { useReadStateStore } from "../stores/useReadStateStore";
import { MessageItem } from "./MessageItem";
import { Spin, Empty } from "antd";
import * as api from "../lib/api";
import type { CSSProperties } from "react";

const centerStyle: CSSProperties = { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" };
const listStyle: CSSProperties = { flex: 1, overflowY: "auto", paddingTop: "var(--space-sm)", paddingBottom: 0, paddingLeft: 0, paddingRight: 0, display: "flex", flexDirection: "column", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" };
const typingBarStyle: CSSProperties = {
  padding: "var(--space-xs) var(--content-pad)", fontSize: "var(--font-size-sm)", color: "var(--text-muted)",
  minHeight: "var(--space-xxl)", display: "flex", alignItems: "center", gap: "var(--space-xs)",
};

const NEAR_BOTTOM_THRESHOLD = 100;

/** Persists across mounts so revisiting a channel with no new messages skips the ack call. */
const lastAckedIds = new Map<string, string>();

const dotKeyframes = `
@keyframes typingDot {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}`;

function TypingDots() {
  return (
    <>
      <style>{dotKeyframes}</style>
      <span style={{ display: "inline-flex", gap: "var(--space-xxs)", marginRight: "var(--space-xs)" }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            width: "var(--space-xs)", height: "var(--space-xs)", borderRadius: "50%", background: "currentColor",
            display: "inline-block", animation: `typingDot 1.4s infinite ease-in-out`,
            animationDelay: `${i * 0.2}s`,
          }} />
        ))}
      </span>
    </>
  );
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD;
}

export function MessageList({ channelId }: { channelId: string }) {
  const messages = useMessageStore((s) => s.messages[channelId]);
  const setMessages = useMessageStore((s) => s.setMessages);
  const typingUsersRaw = useTypingStore((s) => s.typingUsers[channelId]);
  const typingUsers = useMemo(() => typingUsersRaw ?? [], [typingUsersRaw]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const wasNearBottomRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    let cancelled = false;
    prevCountRef.current = 0;
    wasNearBottomRef.current = true;
    api.fetchMessages(channelId).then((msgs) => {
      if (!cancelled) {
        const reversed = msgs.reverse();
        setMessages(channelId, reversed);
        prevCountRef.current = reversed.length;
        requestAnimationFrame(() => scrollToBottom("instant"));

        // Auto-ack: now that messages are loaded, ack the last one (skip if already acked)
        if (reversed.length > 0) {
          const lastMsg = reversed[reversed.length - 1];
          if (lastMsg.id !== lastAckedIds.get(channelId)) {
            lastAckedIds.set(channelId, lastMsg.id);
            useReadStateStore.getState().clearUnread(channelId);
            api.ackMessage(channelId, lastMsg.id).catch(() => {});
          }
        }
      }
    }).catch((err) => console.error("loadMessages:", err));
    return () => { cancelled = true; };
  }, [channelId, setMessages, scrollToBottom]);

  // Track near-bottom on scroll so we know user intent even when content grows
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => { wasNearBottomRef.current = isNearBottom(container); };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // New message added → scroll if was near bottom
  useEffect(() => {
    if (!messages) return;
    if (messages.length > prevCountRef.current && wasNearBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom());
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

  const typingLabel = typingUsers.length === 1
    ? `${typingUsers[0].username} is typing`
    : typingUsers.length === 2
    ? `${typingUsers[0].username} and ${typingUsers[1].username} are typing`
    : typingUsers.length > 2
    ? "Several people are typing"
    : null;

  return (
    <>
      <div ref={scrollContainerRef} style={listStyle} className="scroll-container">
        {messages.map((msg, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const isGroupStart = !prev || prev.author.id !== msg.author.id ||
            (new Date(msg.timestamp).getTime() - new Date(prev.timestamp).getTime() > 7 * 60 * 1000);
          return <MessageItem key={msg.id} message={msg} isGroupStart={isGroupStart} />;
        })}
        <div ref={bottomRef} />
      </div>
      <div style={typingBarStyle}>
        {typingLabel && <><TypingDots />{typingLabel}…</>}
      </div>
    </>
  );
}
