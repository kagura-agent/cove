import { create } from "zustand";

interface ReadStateState {
  readStates: Record<string, string>; // channelId → lastReadMessageId
  unreadChannels: Record<string, boolean>;
  mentionCounts: Record<string, number>;
  initReadStates: (states: Array<{ channel_id: string; last_read_message_id: string | null; last_message_id: string | null; mention_count?: number }>) => void;
  markRead: (channelId: string, messageId: string) => void;
  setUnread: (channelId: string) => void;
  setMentioned: (channelId: string) => void;
  clearUnread: (channelId: string) => void;
  removeChannel: (channelId: string) => void;
  getLastReadId: (channelId: string) => string | undefined;
}

export const useReadStateStore = create<ReadStateState>((set, get) => ({
  readStates: {},
  unreadChannels: {},
  mentionCounts: {},
  initReadStates: (states) => {
    const rs: Record<string, string> = {};
    const unread: Record<string, boolean> = {};
    const mentions: Record<string, number> = {};
    for (const s of states) {
      if (s.last_read_message_id) {
        rs[s.channel_id] = s.last_read_message_id;
      }
      // Channel is unread if it has messages and either no read cursor or cursor != latest message
      if (s.last_message_id && s.last_read_message_id !== s.last_message_id) {
        unread[s.channel_id] = true;
      }
      if (s.mention_count && s.mention_count > 0) {
        mentions[s.channel_id] = s.mention_count;
      }
    }
    set({ readStates: rs, unreadChannels: unread, mentionCounts: mentions });
  },
  markRead: (channelId, messageId) => set((s) => ({
    readStates: { ...s.readStates, [channelId]: messageId },
    unreadChannels: { ...s.unreadChannels, [channelId]: false },
    mentionCounts: { ...s.mentionCounts, [channelId]: 0 },
  })),
  setUnread: (channelId) => set((s) => ({
    unreadChannels: { ...s.unreadChannels, [channelId]: true },
  })),
  setMentioned: (channelId) => set((s) => ({
    unreadChannels: { ...s.unreadChannels, [channelId]: true },
    mentionCounts: { ...s.mentionCounts, [channelId]: (s.mentionCounts[channelId] || 0) + 1 },
  })),
  clearUnread: (channelId) => set((s) => ({
    unreadChannels: { ...s.unreadChannels, [channelId]: false },
    mentionCounts: { ...s.mentionCounts, [channelId]: 0 },
  })),
  removeChannel: (channelId) => set((s) => {
    const { [channelId]: _rs, ...restReadStates } = s.readStates;
    const { [channelId]: _ur, ...restUnread } = s.unreadChannels;
    const { [channelId]: _mc, ...restMentions } = s.mentionCounts;
    return { readStates: restReadStates, unreadChannels: restUnread, mentionCounts: restMentions };
  }),
  getLastReadId: (channelId) => get().readStates[channelId],
}));
