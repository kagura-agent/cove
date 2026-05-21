import { useState } from "react";
import { useBotStore } from "../stores/useBotStore";
import { Form, Input, Button } from "antd";
import { TokenDisplay } from "./TokenDisplay";

export function BotCreateForm() {
  const createBot = useBotStore((s) => s.createBot);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🤖");
  const [bio, setBio] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
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
      <Form layout="vertical" onFinish={handleSubmit}>
        <Form.Item label="Bot Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Bot" />
        </Form.Item>
        <div style={{ display: "flex", gap: 8 }}>
          <Form.Item label="Emoji" style={{ width: 80 }}>
            <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} />
          </Form.Item>
          <Form.Item label="Bio" style={{ flex: 1 }}>
            <Input.TextArea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="What does this bot do?" rows={1} style={{ resize: "none" }} />
          </Form.Item>
        </div>
        <Button type="primary" htmlType="submit" loading={loading} disabled={!name.trim()} block>
          {loading ? "Creating…" : "Create Bot"}
        </Button>
      </Form>
      {token && <TokenDisplay token={token} onClose={() => setToken(null)} />}
    </>
  );
}
