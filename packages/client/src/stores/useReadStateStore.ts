import { create } from "zustand";

interface ReadStateState {
  readStates: Record<string, string>; // channelId → lastReadMessageId
  unreadChannels: Record<string, boolean>;
  initReadStates: (states: Array<{ channel_id: string; last_read_message_id: string | null; last_message_id: string | null }>) => void;
  markRead: (channelId: string, messageId: string) => void;
  setUnread: (channelId: string) => void;
  clearUnread: (channelId: string) => void;
  removeChannel: (channelId: string) => void;
  getLastReadId: (channelId: string) => string | undefined;
}

export const useReadStateStore = create<ReadStateState>((set, get) => ({
  readStates: {},
  unreadChannels: {},
  initReadStates: (states) => {
    const rs: Record<string, string> = {};
    const unread: Record<string, boolean> = {};
    for (const s of states) {
      if (s.last_read_message_id) {
        rs[s.channel_id] = s.last_read_message_id;
      }
      // Channel is unread if it has messages and either no read cursor or cursor != latest message
      if (s.last_message_id && s.last_read_message_id !== s.last_message_id) {
        unread[s.channel_id] = true;
      }
    }
    set({ readStates: rs, unreadChannels: unread });
  },
  markRead: (channelId, messageId) => set((s) => ({
    readStates: { ...s.readStates, [channelId]: messageId },
    unreadChannels: { ...s.unreadChannels, [channelId]: false },
  })),
  setUnread: (channelId) => set((s) => ({
    unreadChannels: { ...s.unreadChannels, [channelId]: true },
  })),
  clearUnread: (channelId) => set((s) => ({
    unreadChannels: { ...s.unreadChannels, [channelId]: false },
  })),
  removeChannel: (channelId) => set((s) => {
    const { [channelId]: _rs, ...restReadStates } = s.readStates;
    const { [channelId]: _ur, ...restUnread } = s.unreadChannels;
    return { readStates: restReadStates, unreadChannels: restUnread };
  }),
  getLastReadId: (channelId) => get().readStates[channelId],
}));
