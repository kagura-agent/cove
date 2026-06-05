import { useRef, useState, useCallback, useLayoutEffect } from "react";
import { Button } from "antd";
import { SendOutlined } from "@ant-design/icons";
import * as api from "../lib/api";
import type { CSSProperties } from "react";
import "./MessageInput.css";

const isTouchDevice =
  typeof window !== "undefined" &&
  matchMedia("(pointer: coarse)").matches;

const wrapperStyle: CSSProperties = {
  display: "flex", alignItems: "flex-end", gap: "var(--space-sm)",
  padding: "0 var(--content-pad)", background: "var(--bg-secondary)",
  borderTop: "1px solid var(--border-subtle)",
  minHeight: "100%", boxSizing: "border-box",
};
const textareaStyle: CSSProperties = {
  borderRadius: "var(--input-radius)", background: "var(--bg-input)", border: "none",
  flex: 1, resize: "none", minHeight: "var(--control-height-md)", maxHeight: 200, overflowY: "auto",
  padding: "var(--space-sm) var(--space-md)", fontSize: "var(--font-size-md)", lineHeight: "1.5", color: "inherit",
  fontFamily: "inherit", boxSizing: "border-box",
  margin: "var(--space-sm) 0",
};

export function MessageInput({ channelId }: { channelId: string }) {
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [content]);

  const sendTypingThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now;
      api.sendTyping(channelId).catch(() => {});
    }
  }, [channelId]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    if (e.target.value.trim()) sendTypingThrottled();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isTouchDevice) return;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleSubmit() {
    const text = content.trim();
    if (!text) return;
    setContent("");
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
    }
    try {
      await api.sendMessage(channelId, text);
    } catch (err) {
      console.error("send:", err);
      setContent(text);
    }
  }

  return (
    <div style={wrapperStyle}>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Say something…"
        aria-label="Message"
        maxLength={2000}
        autoComplete="off"
        rows={1}
        style={textareaStyle}
        className="message-textarea"
      />
      <Button
        type="text"
        shape="circle"
        icon={<SendOutlined />}
        onClick={handleSubmit}
        style={{
          color: content.trim() ? "var(--accent)" : "var(--text-muted)",
          width: "var(--icon-button-size-md)", height: "var(--icon-button-size-md)", minWidth: "var(--icon-button-size-md)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "var(--space-sm) 0", flexShrink: 0,
        }}
      />
    </div>
  );
}
