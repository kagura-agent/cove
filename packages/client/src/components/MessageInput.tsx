import { useRef, useState, useCallback } from "react";
import { Input } from "antd";
import type { InputRef } from "antd";
import * as api from "../lib/api";
import type { CSSProperties } from "react";

const wrapperStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: "var(--space-sm)",
  padding: "0 var(--content-pad)", background: "var(--bg-secondary)",
  borderTop: "1px solid var(--border-subtle)",
  height: "var(--footer-height)", flexShrink: 0,
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + var(--keyboard-offset, 0px))",
};
const inputStyle: CSSProperties = { borderRadius: "var(--input-radius)", background: "var(--bg-input)", border: "none" };

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
    </div>
  );
}
