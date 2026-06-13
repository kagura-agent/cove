import { create } from "zustand";
import type { Message } from "../types";
import type { Reaction } from "@cove/shared";

export type PendingStatus = "pending" | "failed";

interface MessageState {
  messages: Record<string, Message[]>;
  /** Tracks pending/failed status for optimistic messages, keyed by temp message ID */
  pendingStatus: Record<string, PendingStatus>;
  setMessages: (channelId: string, messages: Message[]) => void;
  addMessage: (channelId: string, message: Message) => void;
  addPendingMessage: (channelId: string, message: Message) => void;
  reconcilePending: (channelId: string, nonce: string, realMessage: Message) => void;
  markFailed: (messageId: string) => void;
  removePendingMessage: (channelId: string, messageId: string) => void;
  updateMessage: (channelId: string, messageId: string, content: string, editedTimestamp?: string | null, mentions?: Message["mentions"]) => void;
  removeMessage: (channelId: string, messageId: string) => void;
  removeChannelMessages: (channelId: string) => void;
  prependMessages: (channelId: string, messages: Message[]) => void;
  addReaction: (channelId: string, messageId: string, emoji: string, me: boolean, count: number) => void;
  removeReaction: (channelId: string, messageId: string, emoji: string, me: boolean, count: number) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: {},
  pendingStatus: {},
  setMessages: (channelId, messages) =>
    set((s) => ({ messages: { ...s.messages, [channelId]: messages } })),
  addMessage: (channelId, message) =>
    set((s) => {
      const existing = s.messages[channelId] ?? [];
      if (existing.some((m) => m.id === message.id)) return s;
      return { messages: { ...s.messages, [channelId]: [...existing, message] } };
    }),
  addPendingMessage: (channelId, message) =>
    set((s) => {
      const existing = s.messages[channelId] ?? [];
      return {
        messages: { ...s.messages, [channelId]: [...existing, message] },
        pendingStatus: { ...s.pendingStatus, [message.id]: "pending" as PendingStatus },
      };
    }),
  reconcilePending: (channelId, nonce, realMessage) =>
    set((s) => {
      const msgs = s.messages[channelId];
      if (!msgs) return s;
      const pendingIdx = msgs.findIndex((m) => m.nonce === nonce && s.pendingStatus[m.id]);
      if (pendingIdx === -1) return s;
      const pendingId = msgs[pendingIdx].id;
      const newMsgs = [...msgs];
      newMsgs[pendingIdx] = realMessage;
      const { [pendingId]: _, ...restPending } = s.pendingStatus;
      return {
        messages: { ...s.messages, [channelId]: newMsgs },
        pendingStatus: restPending,
      };
    }),
  markFailed: (messageId) =>
    set((s) => ({
      pendingStatus: { ...s.pendingStatus, [messageId]: "failed" as PendingStatus },
    })),
  removePendingMessage: (channelId, messageId) =>
    set((s) => {
      const msgs = s.messages[channelId];
      if (!msgs) return s;
      const { [messageId]: _, ...restPending } = s.pendingStatus;
      return {
        messages: { ...s.messages, [channelId]: msgs.filter((m) => m.id !== messageId) },
        pendingStatus: restPending,
      };
    }),
  updateMessage: (channelId, messageId, content, editedTimestamp, mentions) =>
    set((s) => {
      const msgs = s.messages[channelId];
      if (!msgs) return s;
      return { messages: { ...s.messages, [channelId]: msgs.map((m) => m.id === messageId ? { ...m, content, ...(editedTimestamp !== undefined ? { edited_timestamp: editedTimestamp } : {}), ...(mentions !== undefined ? { mentions } : {}) } : m) } };
    }),
  removeMessage: (channelId, messageId) =>
    set((s) => {
      const msgs = s.messages[channelId];
      if (!msgs) return s;
      return {
        messages: {
          ...s.messages,
          [channelId]: msgs
            .filter((m) => m.id !== messageId)
            .map((m) =>
              m.message_reference?.message_id === messageId
                ? { ...m, referenced_message: null }
                : m
            ),
        },
      };
    }),
  removeChannelMessages: (channelId) =>
    set((s) => {
      if (!(channelId in s.messages)) return s;
      const { [channelId]: _, ...rest } = s.messages;
      return { messages: rest };
    }),
  prependMessages: (channelId, older) =>
    set((s) => {
      const existing = s.messages[channelId] ?? [];
      // Deduplicate by id
      const existingIds = new Set(existing.map((m) => m.id));
      const unique = older.filter((m) => !existingIds.has(m.id));
      if (unique.length === 0) return s;
      return { messages: { ...s.messages, [channelId]: [...unique, ...existing] } };
    }),
  addReaction: (channelId, messageId, emoji, me, count) =>
    set((s) => {
      const msgs = s.messages[channelId];
      if (!msgs) return s;
      return {
        messages: {
          ...s.messages,
          [channelId]: msgs.map((m) => {
            if (m.id !== messageId) return m;
            const reactions = [...(m.reactions ?? [])] as Reaction[];
            const idx = reactions.findIndex((r) => r.emoji.name === emoji);
            if (idx >= 0) {
              reactions[idx] = { ...reactions[idx], count, me: me ? true : reactions[idx].me };
            } else {
              reactions.push({ emoji: { id: null, name: emoji }, count, me });
            }
            return { ...m, reactions };
          }),
        },
      };
    }),
  removeReaction: (channelId, messageId, emoji, me, count) =>
    set((s) => {
      const msgs = s.messages[channelId];
      if (!msgs) return s;
      return {
        messages: {
          ...s.messages,
          [channelId]: msgs.map((m) => {
            if (m.id !== messageId) return m;
            const reactions = [...(m.reactions ?? [])] as Reaction[];
            const idx = reactions.findIndex((r) => r.emoji.name === emoji);
            if (idx < 0) return m;
            if (count <= 0) {
              reactions.splice(idx, 1);
            } else {
              reactions[idx] = { ...reactions[idx], count, me: me ? false : reactions[idx].me };
            }
            return { ...m, reactions };
          }),
        },
      };
    }),
}));
