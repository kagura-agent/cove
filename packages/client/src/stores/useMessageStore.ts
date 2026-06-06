import { create } from "zustand";
import type { Message } from "../types";

interface MessageState {
  messages: Record<string, Message[]>;
  setMessages: (channelId: string, messages: Message[]) => void;
  addMessage: (channelId: string, message: Message) => void;
  updateMessage: (channelId: string, messageId: string, content: string, editedTimestamp?: string | null) => void;
  removeMessage: (channelId: string, messageId: string) => void;
  removeChannelMessages: (channelId: string) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: {},
  setMessages: (channelId, messages) =>
    set((s) => ({ messages: { ...s.messages, [channelId]: messages } })),
  addMessage: (channelId, message) =>
    set((s) => {
      const existing = s.messages[channelId] ?? [];
      if (existing.some((m) => m.id === message.id)) return s;
      return { messages: { ...s.messages, [channelId]: [...existing, message] } };
    }),
  updateMessage: (channelId, messageId, content, editedTimestamp) =>
    set((s) => {
      const msgs = s.messages[channelId];
      if (!msgs) return s;
      return { messages: { ...s.messages, [channelId]: msgs.map((m) => m.id === messageId ? { ...m, content, ...(editedTimestamp !== undefined ? { edited_timestamp: editedTimestamp } : {}) } : m) } };
    }),
  removeMessage: (channelId, messageId) =>
    set((s) => {
      const msgs = s.messages[channelId];
      if (!msgs) return s;
      return { messages: { ...s.messages, [channelId]: msgs.filter((m) => m.id !== messageId) } };
    }),
  removeChannelMessages: (channelId) =>
    set((s) => {
      if (!(channelId in s.messages)) return s;
      const { [channelId]: _, ...rest } = s.messages;
      return { messages: rest };
    }),
}));
