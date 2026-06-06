import { create } from "zustand";

export interface TypingUser {
  userId: string;
  username: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface TypingState {
  typingUsers: Record<string, TypingUser[]>;
  clearTyping: (channelId: string, userId: string) => void;
  removeChannel: (channelId: string) => void;
}

/** Set of active typing timeout IDs — shared with gateway-subscriptions for teardown. */
export const typingTimeoutIds = new Set<ReturnType<typeof setTimeout>>();

export const useTypingStore = create<TypingState>((set) => ({
  typingUsers: {},
  clearTyping: (channelId, userId) =>
    set((s) => {
      const users = s.typingUsers[channelId];
      if (!users) return s;
      const user = users.find((u) => u.userId === userId);
      if (user) {
        clearTimeout(user.timeout);
        typingTimeoutIds.delete(user.timeout);
      }
      const filtered = users.filter((u) => u.userId !== userId);
      return { typingUsers: { ...s.typingUsers, [channelId]: filtered } };
    }),
  removeChannel: (channelId) =>
    set((s) => {
      const users = s.typingUsers[channelId];
      if (!users) return s;
      for (const u of users) {
        clearTimeout(u.timeout);
        typingTimeoutIds.delete(u.timeout);
      }
      const { [channelId]: _, ...rest } = s.typingUsers;
      return { typingUsers: rest };
    }),
}));
