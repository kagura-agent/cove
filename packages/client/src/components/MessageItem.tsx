import { useUserStore } from "../stores/useUserStore";
import type { Message } from "../types";

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return time;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  } catch { return ""; }
}

export function MessageItem({ message }: { message: Message }) {
  const userId = useUserStore((s) => s.id);
  const isSelf = message.author.id === userId;

  return (
    <div className={`max-w-[75%] max-sm:max-w-[80%] px-3.5 py-2.5 rounded-[14px] text-sm leading-relaxed break-words animate-fade-in ${isSelf ? "bg-msg-own self-end rounded-br-[4px]" : "bg-msg-other self-start rounded-bl-[4px]"}`}>
      <div className={`text-xs font-semibold mb-0.5 ${isSelf ? "text-purple-300" : "text-primary"}`}>{message.author.username}</div>
      <div className="whitespace-pre-wrap">{message.content}</div>
      <div className="text-[10px] text-muted-foreground/60 mt-1 text-right">{formatTime(message.timestamp)}</div>
    </div>
  );
}
