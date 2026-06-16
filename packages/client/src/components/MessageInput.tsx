import { useRef, useState, useCallback, useLayoutEffect, useEffect, useMemo } from "react";
import { Button } from "antd";
import { SendOutlined } from "@ant-design/icons";
import * as api from "../lib/api";
import { useMessageStore } from "../stores/useMessageStore";
import { useUserStore } from "../stores/useUserStore";
import { useReplyStore } from "../stores/useReplyStore";
import { MentionAutocomplete } from "./MentionAutocomplete";
import type { Message } from "../types";
import type { CSSProperties } from "react";
import "./MessageInput.css";

const isTouchDevice =
  typeof window !== "undefined" &&
  matchMedia("(pointer: coarse)").matches;

const wrapperStyle: CSSProperties = {
  display: "flex", alignItems: "flex-end", gap: "var(--space-sm)",
  padding: "0 var(--content-pad)", background: "var(--bg-secondary)",
  borderTop: "1px solid var(--border-subtle)",
  boxSizing: "border-box",
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
  const [cursorPos, setCursorPos] = useState(0);
  const [showMention, setShowMention] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);
  const mentionHasResults = useRef(false);
  // Track active mentions: displayName → userId
  const mentionMapRef = useRef<Map<string, string>>(new Map());
  const hasReply = useReplyStore((s) => !!s.replyingTo[channelId]);

  // Create preview URLs and clean up on change
  const previewUrls = useMemo(() => pendingFiles.map(f => URL.createObjectURL(f)), [pendingFiles]);
  useEffect(() => {
    return () => {
      previewUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  // Clear mention state when switching channels
  useEffect(() => {
    mentionMapRef.current.clear();
    setShowMention(false);
  }, [channelId]);

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

  function syncCursor() {
    const ta = textareaRef.current;
    if (ta) setCursorPos(ta.selectionStart);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    setCursorPos(e.target.selectionStart);
    // Check if we should show mention autocomplete
    const before = e.target.value.slice(0, e.target.selectionStart);
    setShowMention(/@\w*$/.test(before));
    if (e.target.value.trim()) sendTypingThrottled();
  }

  function handlePaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
      e.preventDefault();
      setPendingFiles(prev => [...prev, ...files]);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
      setPendingFiles(prev => [...prev, ...files]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isTouchDevice) return;
    // Only intercept keys when mention autocomplete is actually visible with results
    if (showMention && mentionHasResults.current) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Tab" || e.key === "Escape" || e.key === "Enter") return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleSubmit() {
    let text = content.trim();
    if (!text && pendingFiles.length === 0) return;
    // Convert display mentions (@username) to wire format (<@userId>)
    // Use word-boundary-aware replacement to prevent @alice matching @aliceWonderland
    const entries = [...mentionMapRef.current.entries()]
      .sort((a, b) => b[0].length - a[0].length);
    for (const [username, userId] of entries) {
      const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`@${escaped}(?!\\w)`, "g"), `<@${userId}>`);
    }
    mentionMapRef.current.clear();
    setContent("");
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
    }

    // Capture and clear reply state before async work
    const replyMsg = useReplyStore.getState().replyingTo[channelId];
    if (replyMsg) {
      useReplyStore.getState().clearReply(channelId);
    }

    const nonce = crypto.randomUUID();
    const tempId = `pending-${nonce}`;
    const user = useUserStore.getState();

    // Build a pending message and insert immediately
    const pendingMessage: Message = {
      id: tempId,
      channel_id: channelId,
      content: text,
      author: {
        id: user.id || "0",
        username: user.username || "You",
        bot: false,
        avatar: null,
        discriminator: "0",
        global_name: user.global_name ?? null,
      },
      timestamp: new Date().toISOString(),
      type: 0,
      attachments: [],
      embeds: [],
      mentions: [],
      mention_roles: [],
      pinned: false,
      tts: false,
      mention_everyone: false,
      nonce,
      ...(replyMsg ? {
        message_reference: { message_id: replyMsg.id, channel_id: channelId },
        referenced_message: replyMsg,
      } : {}),
    };

    useMessageStore.getState().addPendingMessage(channelId, pendingMessage);

    try {
      const messageReference = replyMsg ? { message_id: replyMsg.id } : undefined;

      if (pendingFiles.length > 0) {
        const real = await api.sendMessageWithAttachments(channelId, text, pendingFiles, nonce, messageReference);
        setPendingFiles([]);
        useMessageStore.getState().reconcilePending(channelId, nonce, real);
      } else {
        const real = await api.sendMessage(channelId, text, nonce, messageReference);
        useMessageStore.getState().reconcilePending(channelId, nonce, real);
      }
    } catch (err) {
      console.error("send:", err);
      useMessageStore.getState().markFailed(tempId);
    }
  }

  const handleMentionSelect = useCallback((userId: string, username: string, startPos: number, endPos: number) => {
    const before = content.slice(0, startPos);
    const after = content.slice(endPos);
    // Display @username in textarea, convert to <@id> on send
    const mention = `@${username} `;
    const newContent = before + mention + after;
    mentionMapRef.current.set(username, userId);
    setContent(newContent);
    setShowMention(false);
    const newCursor = startPos + mention.length;
    setCursorPos(newCursor);
    // Focus and set cursor position
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.selectionStart = newCursor;
        ta.selectionEnd = newCursor;
      }
    });
  }, [content]);

  return (
    <div
      style={{ position: "relative", background: "var(--bg-secondary)", borderTop: hasReply ? "none" : "1px solid var(--border-subtle)" }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {showMention && (
        <MentionAutocomplete
          text={content}
          cursorPos={cursorPos}
          onSelect={handleMentionSelect}
          onClose={() => setShowMention(false)}
          onHasResults={(has) => { mentionHasResults.current = has; }}
        />
      )}
      {pendingFiles.length > 0 && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 12px', flexWrap: 'wrap', borderBottom: '1px solid var(--border-color, #3f4147)' }}>
          {pendingFiles.map((file, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={previewUrls[i]}
                alt={file.name}
                style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-color, #3f4147)' }}
              />
              <button
                onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                style={{ position: 'absolute', top: -6, right: -6, background: '#ed4245', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 12, lineHeight: '20px', padding: 0 }}
              >×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-sm)", padding: "0 var(--content-pad)" }}>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelect={syncCursor}
          onClick={syncCursor}
          onBlur={() => { setTimeout(() => setShowMention(false), 150); }}
          onPaste={handlePaste}
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
    </div>
  );
}
