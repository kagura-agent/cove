import { useState } from "react";
import { useBotStore } from "../stores/useBotStore";
import { Input, Button } from "antd";
import { TokenDisplay } from "./TokenDisplay";

export function BotCreateForm() {
  const createBot = useBotStore((s) => s.createBot);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const result = await createBot(name.trim(), bio);
      setToken(result.token);
      setName(""); setBio("");
    } catch (err) { console.error("create bot:", err); }
    finally { setLoading(false); }
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 8 }}>Bot Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Bot" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 8 }}>Bio</label>
          <Input.TextArea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="What does this bot do?" rows={1} style={{ resize: "none" }} />
        </div>
        <Button type="primary" htmlType="submit" loading={loading} disabled={!name.trim()} block>
          {loading ? "Creating…" : "Create Bot"}
        </Button>
      </form>
      {token && <TokenDisplay token={token} onClose={() => setToken(null)} />}
    </>
  );
}
