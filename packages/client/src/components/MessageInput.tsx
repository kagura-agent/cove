import { useRef, useState, useCallback } from "react";
import { Input, Button } from "antd";
import type { InputRef } from "antd";
import { SendOutlined } from "@ant-design/icons";
import * as api from "../lib/api";
import type { CSSProperties } from "react";

const wrapperStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "12px 16px", background: "var(--bg-surface)",
  borderTop: "1px solid rgba(255,255,255,0.08)",
  paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
};
const inputStyle: CSSProperties = { borderRadius: 8, background: "#383a40", border: "none" };

export function MessageInput({ channelId }: { channelId: string }) {
  const [content, setContent] = useState("");
  const inputRef = useRef<InputRef>(null);
  const lastTypingRef = useRef(0);

  const sendTypingThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now;
      api.sendTyping(channelId).catch(() => {});
    }
  }, [channelId]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setContent(e.target.value);
    if (e.target.value.trim()) sendTypingThrottled();
  }

  async function handleSubmit() {
    const text = content.trim();
    if (!text) return;
    setContent("");
    inputRef.current?.focus();
    try {
      await api.sendMessage(channelId, text);
    } catch (err) {
      console.error("send:", err);
      setContent(text);
    }
  }

  return (
    <div style={wrapperStyle}>
      <Input
        ref={inputRef}
        value={content}
        onChange={handleChange}
        onPressEnter={handleSubmit}
        placeholder="Say something…"
        maxLength={2000}
        autoComplete="off"
        size="large"
        style={inputStyle}
      />
      <Button type="primary" shape="circle" size="large" icon={<SendOutlined />} onClick={handleSubmit} />
    </div>
  );
}
