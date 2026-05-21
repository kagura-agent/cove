import { useEffect } from "react";
import { useBotStore } from "../stores/useBotStore";
import { Button } from "./ui/button";
import { BotCreateForm } from "./BotCreateForm";
import { Trash2 } from "lucide-react";

export function BotManagement() {
  const { bots, fetchBots, deleteBot } = useBotStore();

  useEffect(() => { fetchBots().catch(console.error); }, [fetchBots]);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete bot "${name}"?`)) return;
    try { await deleteBot(id); } catch (err) { console.error("delete bot:", err); }
  }

  return (
    <div className="space-y-4">
      {bots.length > 0 && (
        <div className="space-y-2">
          {bots.map((bot) => (
            <div key={bot.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted">
              <span className="text-lg">{bot.emoji || "🤖"}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{bot.username}</div>
                {bot.bio && <div className="text-xs text-muted-foreground/60 truncate">{bot.bio}</div>}
              </div>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(bot.id, bot.username)} className="shrink-0 h-8 w-8 text-muted-foreground/60 hover:text-red-500">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <BotCreateForm />
    </div>
  );
}
