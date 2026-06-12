import { Typography } from "antd";
import type { Message } from "../types";
import type { CSSProperties } from "react";
import { pickAvatarColor, getContrastTextColor } from "../lib/avatar-palette";
import { ChatMarkdown } from "./ChatMarkdown";
import { MessageReplyQuote } from "./MessageReplyQuote";
import { useMessageStore } from "../stores/useMessageStore";
import { useReplyStore } from "../stores/useReplyStore";
import type { PendingStatus } from "../stores/useMessageStore";
import * as api from "../lib/api";

const QUICK_EMOJIS = ["👍", "🔥", "❤️", "😂"];

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return `Today at ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
    if (isYesterday) return `Yesterday at ${time}`;
    return `${d.toLocaleDateString([], { month: "2-digit", day: "2-digit", year: "numeric" })} ${time}`;
  } catch { return ""; }
}

function formatCompactTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function avatarColor(name: string): string {
  return pickAvatarColor(name);
}


const botBadgeStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  fontWeight: 600,
  color: "var(--text-on-accent)",
  background: "var(--accent)",
  borderRadius: "var(--space-xxs)",
  padding: "1px var(--space-xs)",
  marginLeft: "var(--space-xs)",
  verticalAlign: "middle",
  lineHeight: "var(--font-size-md)",
  display: "inline-block",
};

const editedStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--text-muted)",
  opacity: 0.6,
  marginLeft: "var(--space-xs)",
  userSelect: "none",
};

interface MessageItemProps {
  message: Message;
  isGroupStart: boolean;
  onJumpToMessage?: (messageId: string) => void;
}

function MessageActions({ message }: { message: Message }) {
  const setReplyingTo = useReplyStore((s) => s.setReplyingTo);
  return (
    <div className="message-actions">
      <button
        type="button"
        className="message-actions-btn"
        onClick={() => setReplyingTo(message.channel_id, message)}
        title="Reply"
      >
        ↩
      </button>
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="message-actions-btn"
          onClick={() => api.addReaction(message.channel_id, message.id, emoji)}
          title={emoji}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function ReactionPills({ message }: { message: Message }) {
  const hasReactions = message.reactions && message.reactions.length > 0;
  if (!hasReactions) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
      {message.reactions?.map((r) => (
        <button
          key={r.emoji.id ?? r.emoji.name}
          type="button"
          onClick={() => {
            if (r.me) {
              api.removeReaction(message.channel_id, message.id, r.emoji.name);
            } else {
              api.addReaction(message.channel_id, message.id, r.emoji.name);
            }
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "2px 6px",
            fontSize: "var(--font-size-sm)",
            borderRadius: "4px",
            border: r.me ? "1px solid var(--accent)" : "1px solid var(--bg-modifier-hover)",
            background: r.me ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "var(--bg-modifier-hover)",
            color: r.me ? "var(--accent)" : "var(--text-normal)",
            cursor: "pointer",
            lineHeight: 1.2,
          }}
        >
          <span>{r.emoji.name}</span>
          <span style={{ fontSize: "var(--font-size-xs)", fontWeight: 500 }}>{r.count}</span>
        </button>
      ))}
    </div>
  );
}

const pendingStyle: CSSProperties = {
  opacity: 0.5,
};

const failedRowStyle: CSSProperties = {
  opacity: 0.7,
};

const failedIndicatorStyle: CSSProperties = {
  color: "var(--text-danger, #ed4245)",
  fontSize: "var(--font-size-xs)",
  marginLeft: "var(--space-xs)",
  cursor: "pointer",
  userSelect: "none",
};

function PendingIndicator({ status, messageId, channelId, content, author, messageReference, referencedMessage }: {
  status: PendingStatus | undefined;
  messageId: string;
  channelId: string;
  content: string;
  author: Message["author"];
  messageReference?: Message["message_reference"];
  referencedMessage?: Message["referenced_message"];
}) {
  if (!status || status === "pending") return null;
  // Failed state — show retry + dismiss
  const handleRetry = () => {
    // Remove the old failed message before creating a new pending one
    useMessageStore.getState().removePendingMessage(channelId, messageId);

    const nonce = crypto.randomUUID();
    const tempId = `pending-${nonce}`;
    const pendingMsg: Message = {
      id: tempId,
      channel_id: channelId,
      content,
      author,
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
      ...(messageReference ? { message_reference: messageReference, referenced_message: referencedMessage } : {}),
    };
    useMessageStore.getState().addPendingMessage(channelId, pendingMsg);
    const apiRef = messageReference ? { message_id: messageReference.message_id } : undefined;
    api.sendMessage(channelId, content, nonce, apiRef).then((real) => {
      useMessageStore.getState().reconcilePending(channelId, nonce, real);
    }).catch(() => {
      useMessageStore.getState().markFailed(tempId);
    });
  };
  const handleDismiss = () => {
    useMessageStore.getState().removePendingMessage(channelId, messageId);
  };
  return (
    <span style={failedIndicatorStyle}>
      {" "}Failed to send.{" "}
      <button type="button" onClick={handleRetry} style={{ textDecoration: "underline", cursor: "pointer", background: "none", border: "none", color: "inherit", font: "inherit", padding: 0 }}>Retry</button>
      {" | "}
      <button type="button" onClick={handleDismiss} style={{ textDecoration: "underline", cursor: "pointer", background: "none", border: "none", color: "inherit", font: "inherit", padding: 0 }}>Dismiss</button>
    </span>
  );
}

export function MessageItem({ message, isGroupStart, onJumpToMessage }: MessageItemProps) {
  const pendingStatus = useMessageStore((s) => s.pendingStatus[message.id]);
  const rowExtraStyle = pendingStatus === "pending" ? pendingStyle : pendingStatus === "failed" ? failedRowStyle : undefined;
  const isBot = message.author.bot;
  const initial = message.author.username.charAt(0).toUpperCase();
  const bgColor = avatarColor(message.author.username);
  const textColor = getContrastTextColor(bgColor);

  if (isGroupStart) {
    return (
      <div
        className="discord-msg-row"
        data-message-id={message.id}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--content-gap)",
          padding: "var(--space-xs) var(--message-right-pad) 0 var(--content-pad)",
          marginTop: "var(--content-gap)",
          ...rowExtraStyle,
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: "var(--avatar-size)",
            height: "var(--avatar-size)",
            borderRadius: "50%",
            backgroundColor: bgColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "var(--font-size-lg)",
            fontWeight: 600,
            color: textColor,
            flexShrink: 0,
            cursor: "pointer",
          }}
        >
          {initial}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header: username + badge + timestamp */}
          <div style={{ display: "flex", alignItems: "baseline", lineHeight: 1.375 }}>
            <span
              style={{
                fontSize: "var(--font-size-lg)",
                fontWeight: 500,
                color: "var(--header-primary)",
                cursor: "pointer",
              }}
            >
              {message.author.username}
            </span>
            {isBot && <span style={botBadgeStyle}>APP</span>}
            <Typography.Text
              type="secondary"
              style={{ fontSize: "var(--font-size-sm)", color: "var(--text-muted)", marginLeft: "var(--space-sm)" }}
            >
              {formatTime(message.timestamp)}
            </Typography.Text>
          </div>

          {/* Reply quote */}
          {message.message_reference && (
            <MessageReplyQuote
              referencedMessage={message.referenced_message}
              onClickJump={onJumpToMessage}
            />
          )}

          {/* Message body */}
          <div
            
            style={{
              whiteSpace: "pre-wrap",
              color: "var(--text-normal)",
              fontSize: "var(--font-size-lg)",
              lineHeight: 1.375,
              wordBreak: "break-word",
            }}
          >
            <ChatMarkdown content={message.content} />
            {message.edited_timestamp && <span style={editedStyle}>(edited)</span>}
            <PendingIndicator status={pendingStatus} messageId={message.id} channelId={message.channel_id} content={message.content} author={message.author} messageReference={message.message_reference} referencedMessage={message.referenced_message} />
          </div>

          {/* Reactions */}
          <ReactionPills message={message} />
        </div>

        {/* Hover toolbar */}
        <MessageActions message={message} />
      </div>
    );
  }

  // Grouped (continuation) message — no avatar, show compact timestamp on hover
  return (
    <div
      className="discord-msg-row"
      data-message-id={message.id}
      style={{
        display: "flex",
        alignItems: "flex-start",
        padding: "var(--space-xxs) var(--message-right-pad) 0 var(--content-start)",
        ...rowExtraStyle,
      }}
    >
      <span className="compact-ts">
        {formatCompactTime(message.timestamp)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Reply quote */}
        {message.message_reference && (
          <MessageReplyQuote
            referencedMessage={message.referenced_message}
            onClickJump={onJumpToMessage}
          />
        )}
        <div
          
          style={{
            whiteSpace: "pre-wrap",
            color: "var(--text-normal)",
            fontSize: "var(--font-size-lg)",
            lineHeight: 1.375,
            wordBreak: "break-word",
          }}
        >
          <ChatMarkdown content={message.content} />
          {message.edited_timestamp && <span style={editedStyle}>(edited)</span>}
          <PendingIndicator status={pendingStatus} messageId={message.id} channelId={message.channel_id} content={message.content} author={message.author} messageReference={message.message_reference} referencedMessage={message.referenced_message} />
        </div>

        {/* Reactions */}
        <ReactionPills message={message} />
      </div>

      {/* Hover toolbar */}
      <MessageActions message={message} />
    </div>
  );
}
