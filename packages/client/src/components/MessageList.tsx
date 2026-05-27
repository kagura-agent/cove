import { useEffect, useRef, useMemo } from "react";
import { useMessageStore } from "../stores/useMessageStore";
import { useWebSocketStore } from "../stores/useWebSocketStore";
import { MessageItem } from "./MessageItem";
import { Spin, Empty } from "antd";
import * as api from "../lib/api";
import type { CSSProperties } from "react";

const centerStyle: CSSProperties = { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" };
const listStyle: CSSProperties = { flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 6 };
const typingBarStyle: CSSProperties = {
  padding: "4px 20px", fontSize: 12, color: "var(--text-secondary, rgba(255,255,255,0.5))",
  minHeight: 24, display: "flex", alignItems: "center", gap: 4,
};

const dotKeyframes = `
@keyframes typingDot {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}`;

function TypingDots() {
  return (
    <>
      <style>{dotKeyframes}</style>
      <span style={{ display: "inline-flex", gap: 2, marginRight: 4 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: "50%", background: "currentColor",
            display: "inline-block", animation: `typingDot 1.4s infinite ease-in-out`,
            animationDelay: `${i * 0.2}s`,
          }} />
        ))}
      </span>
    </>
  );
}

export function MessageList({ channelId }: { channelId: string }) {
  const messages = useMessageStore((s) => s.messages[channelId]);
  const setMessages = useMessageStore((s) => s.setMessages);
  const typingUsersRaw = useWebSocketStore((s) => s.typingUsers[channelId]);
  const typingUsers = useMemo(() => typingUsersRaw ?? [], [typingUsersRaw]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api.fetchMessages(channelId).then((msgs) => {
      if (!cancelled) {
        const reversed = msgs.reverse();
        setMessages(channelId, reversed);
        prevCountRef.current = reversed.length;
      }
    }).catch((err) => console.error("loadMessages:", err));
    return () => { cancelled = true; };
  }, [channelId, setMessages]);

  useEffect(() => {
    if (!messages) return;
    if (messages.length > prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCountRef.current = messages.length;
  }, [messages]);

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
      <div style={listStyle}>
        {messages.map((msg) => <MessageItem key={msg.id} message={msg} />)}
        <div ref={bottomRef} />
      </div>
      <div style={typingBarStyle}>
        {typingLabel && <><TypingDots />{typingLabel}…</>}
      </div>
    </>
  );
}
