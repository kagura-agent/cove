import { useState } from "react";
import { useUserStore } from "../stores/useUserStore";
import { Input, Button } from "antd";
import { SendOutlined } from "@ant-design/icons";
import * as api from "../lib/api";

export function MessageInput({ channelId }: { channelId: string }) {
  const [content, setContent] = useState("");
  const user = useUserStore();

  async function handleSubmit() {
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
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: "var(--bg-surface)", borderTop: "1px solid rgba(255,255,255,0.08)", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))" }}>
      <Input
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onPressEnter={handleSubmit}
        placeholder="Say something…"
        maxLength={2000}
        autoComplete="off"
        size="large"
        style={{ borderRadius: 24, background: "rgba(255,255,255,0.08)", border: "none" }}
      />
      <Button
        type="primary"
        shape="circle"
        size="large"
        icon={<SendOutlined />}
        onClick={handleSubmit}
      />
    </div>
  );
}
