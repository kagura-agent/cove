import { useEffect, useRef } from "react";
import { useMessageStore } from "../stores/useMessageStore";
import { MessageItem } from "./MessageItem";
import { Spin, Empty } from "antd";
import * as api from "../lib/api";

export function MessageList({ channelId }: { channelId: string }) {
  const messages = useMessageStore((s) => s.messages[channelId]);
  const setMessages = useMessageStore((s) => s.setMessages);
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
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spin tip="Loading messages…" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Empty image="🌊" imageStyle={{ fontSize: 48, lineHeight: "56px" }} description="No messages yet — be the first!" />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
      {messages.map((msg) => <MessageItem key={msg.id} message={msg} />)}
      <div ref={bottomRef} />
    </div>
  );
}
