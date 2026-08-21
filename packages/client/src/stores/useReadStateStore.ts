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

/**
 * Compare two message ids. Message ids are snowflakes (numeric strings);
 * compare as BigInt to avoid float precision loss on 64-bit ids.
 * Returns <0 if a < b, 0 if equal, >0 if a > b.
 */
function compareIds(a: string, b: string): number {
  const ai = BigInt(a);
  const bi = BigInt(b);
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

export const useReadStateStore = create<ReadStateState>((set, get) => ({
  readStates: {},
  unreadChannels: {},
  mentionCounts: {},
  initReadStates: (states) => set((s) => {
    const rs = { ...s.readStates };
    const unread = { ...s.unreadChannels };
    const mentions = { ...s.mentionCounts };
    for (const st of states) {
      if (st.last_read_message_id) {
        // Merge instead of overwrite: a local cursor that is already ahead of
        // the server value wins (keeps the channel read after refresh/reconnect
        // even if the server ack was delayed or lost).
        const local = s.readStates[st.channel_id];
        if (!local || compareIds(local, st.last_read_message_id) < 0) {
          rs[st.channel_id] = st.last_read_message_id;
        }
      }
      // Channel is unread if it has messages and either no read cursor or cursor != latest message.
      // Local unread=false wins when the local cursor is at/after the server's latest.
      if (st.last_message_id && st.last_read_message_id !== st.last_message_id) {
        const localCursor = rs[st.channel_id];
        const alreadyRead = localCursor && compareIds(localCursor, st.last_message_id) >= 0;
        if (!alreadyRead) {
          unread[st.channel_id] = true;
        }
      } else if (st.last_message_id) {
        delete unread[st.channel_id];
      }
      if (st.mention_count && st.mention_count > 0) {
        mentions[st.channel_id] = st.mention_count;
      }
    }
    return { readStates: rs, unreadChannels: unread, mentionCounts: mentions };
  }),
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
