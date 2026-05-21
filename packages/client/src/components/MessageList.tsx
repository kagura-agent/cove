import { useEffect, useRef } from "react";
import { useMessageStore } from "../stores/useMessageStore";
import { MessageItem } from "./MessageItem";
import * as api from "../lib/api";

export function MessageList({ channelId }: { channelId: string }) {
  const messages = useMessageStore((s) => s.messages[channelId]);
  const setMessages = useMessageStore((s) => s.setMessages);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.fetchMessages(channelId).then((msgs) => {
      if (!cancelled) setMessages(channelId, msgs.reverse());
    }).catch((err) => console.error("loadMessages:", err));
    return () => { cancelled = true; };
  }, [channelId, setMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!messages) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground/60 text-sm">Loading messages…</div>;
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/60 gap-3">
        <span className="text-5xl">🌊</span>
        <p className="text-[15px]">No messages yet — be the first!</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-1.5">
      {messages.map((msg) => <MessageItem key={msg.id} message={msg} />)}
      <div ref={bottomRef} />
    </div>
  );
}
