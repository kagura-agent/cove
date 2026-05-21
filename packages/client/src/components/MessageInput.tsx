import { useState } from "react";
import { useUserStore } from "../stores/useUserStore";
import * as api from "../lib/api";
import { Send } from "lucide-react";

export function MessageInput({ channelId }: { channelId: string }) {
  const [content, setContent] = useState("");
  const user = useUserStore();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text) return;
    setContent("");
    try {
      await api.sendMessage(channelId, text, user.id, user.username);
    } catch (err) {
      console.error("send:", err);
      setContent(text);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 px-3 sm:px-4 py-3 bg-card border-t border-border" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))" }}>
      <input type="text" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Say something…" maxLength={2000} autoComplete="off" className="flex-1 px-4 py-3 rounded-3xl bg-input text-foreground text-[15px] max-sm:text-[16px] outline-none border-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring transition-shadow min-w-0" />
      <button type="submit" aria-label="Send" className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:bg-primary/80 active:scale-[0.93] transition-all cursor-pointer">
        <Send className="w-5 h-5" />
      </button>
    </form>
  );
}
