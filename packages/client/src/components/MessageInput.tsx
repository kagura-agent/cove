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
    <form onSubmit={handleSubmit} className="flex items-center gap-2 px-3 sm:px-4 py-3 bg-bg-surface border-t border-border" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))" }}>
      <input type="text" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Say something…" maxLength={2000} autoComplete="off" className="flex-1 px-4 py-3 rounded-3xl bg-bg-input text-text-primary text-[15px] max-sm:text-[16px] outline-none border-none placeholder:text-text-dim focus:shadow-[0_0_0_2px_var(--color-accent)] transition-shadow min-w-0" />
      <button type="submit" aria-label="Send" className="w-11 h-11 rounded-full bg-accent text-bg-deep flex items-center justify-center shrink-0 hover:bg-accent-hover active:scale-[0.93] transition-all cursor-pointer">
        <Send className="w-5 h-5" />
      </button>
    </form>
  );
}
