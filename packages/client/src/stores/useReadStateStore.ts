import { create } from "zustand";

interface ReadStateState {
  readStates: Record<string, string>; // channelId → lastReadMessageId
  unreadChannels: Record<string, boolean>;
  /** Snapshot of lastReadMessageId at channel open time (for NEW divider placement) */
  channelOpenReadIds: Record<string, string>;
  initReadStates: (states: Array<{ channel_id: string; last_read_message_id: string | null; last_message_id: string | null }>) => void;
  markRead: (channelId: string, messageId: string) => void;
  setUnread: (channelId: string) => void;
  clearUnread: (channelId: string) => void;
  removeChannel: (channelId: string) => void;
  getLastReadId: (channelId: string) => string | undefined;
  /** Snapshot the current read state for a channel (call on channel open) */
  snapshotChannelOpen: (channelId: string) => void;
  /** Clear the snapshot (call when unread divider should disappear) */
  clearChannelOpenSnapshot: (channelId: string) => void;
}

export const useReadStateStore = create<ReadStateState>((set, get) => ({
  readStates: {},
  unreadChannels: {},
  channelOpenReadIds: {},
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
    const { [channelId]: _co, ...restOpen } = s.channelOpenReadIds;
    return { readStates: restReadStates, unreadChannels: restUnread, channelOpenReadIds: restOpen };
  }),
  getLastReadId: (channelId) => get().readStates[channelId],
  snapshotChannelOpen: (channelId) => {
    const current = get().readStates[channelId];
    if (current) {
      set((s) => ({ channelOpenReadIds: { ...s.channelOpenReadIds, [channelId]: current } }));
    }
  },
  clearChannelOpenSnapshot: (channelId) => set((s) => {
    const { [channelId]: _, ...rest } = s.channelOpenReadIds;
    return { channelOpenReadIds: rest };
  }),
}));
