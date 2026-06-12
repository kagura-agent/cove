import { create } from "zustand";
import type { Message } from "../types";

interface ReplyState {
  /** The message being replied to, keyed by channel. */
  replyingTo: Record<string, Message | null>;
  setReplyingTo: (channelId: string, message: Message | null) => void;
  clearReply: (channelId: string) => void;
  /** Clear reply if it references a deleted message. */
  clearReplyForDeletedMessage: (channelId: string, messageId: string) => void;
}

export const useReplyStore = create<ReplyState>((set) => ({
  replyingTo: {},
  setReplyingTo: (channelId, message) =>
    set((s) => ({ replyingTo: { ...s.replyingTo, [channelId]: message } })),
  clearReply: (channelId) =>
    set((s) => ({ replyingTo: { ...s.replyingTo, [channelId]: null } })),
  clearReplyForDeletedMessage: (channelId, messageId) =>
    set((s) => {
      const current = s.replyingTo[channelId];
      if (current?.id === messageId) {
        return { replyingTo: { ...s.replyingTo, [channelId]: null } };
      }
      return s;
    }),
}));
