import { useState } from "react";
import { useBotStore } from "../stores/useBotStore";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { TokenDisplay } from "./TokenDisplay";

export function BotCreateForm() {
  const createBot = useBotStore((s) => s.createBot);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🤖");
  const [bio, setBio] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const result = await createBot(name.trim(), emoji || "🤖", bio);
      setToken(result.token);
      setName(""); setEmoji("🤖"); setBio("");
    } catch (err) { console.error("create bot:", err); }
    finally { setLoading(false); }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="bot-name">Bot Name</Label>
          <Input id="bot-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Bot" />
        </div>
        <div className="flex gap-2">
          <div className="space-y-1">
            <Label htmlFor="bot-emoji">Emoji</Label>
            <Input id="bot-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-16" />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="bot-bio">Bio</Label>
            <Textarea id="bot-bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="What does this bot do?" className="min-h-[40px] h-10 resize-none" />
          </div>
        </div>
        <Button type="submit" disabled={loading || !name.trim()} className="w-full">{loading ? "Creating…" : "Create Bot"}</Button>
      </form>
      {token && <TokenDisplay token={token} onClose={() => setToken(null)} />}
    </>
  );
}
