import { create } from "zustand";

interface TypingEntry {
  userId: string;
  username: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface TypingState {
  /** Map of channelId → active typing users */
  typingUsers: Record<string, TypingEntry[]>;
  addTyping: (channelId: string, userId: string, username: string) => void;
  clearTyping: (channelId: string, userId: string) => void;
}

const TYPING_TIMEOUT_MS = 8000;

export const useTypingStore = create<TypingState>((set, get) => ({
  typingUsers: {},
  addTyping: (channelId, userId, username) => {
    // Clear existing timeout for this user
    get().clearTyping(channelId, userId);
    // Set new timeout
    const timeout = setTimeout(() => {
      get().clearTyping(channelId, userId);
    }, TYPING_TIMEOUT_MS);
    set((s) => {
      const existing = s.typingUsers[channelId] ?? [];
      return {
        typingUsers: {
          ...s.typingUsers,
          [channelId]: [...existing, { userId, username, timeout }],
        },
      };
    });
  },
  clearTyping: (channelId, userId) => {
    set((s) => {
      const existing = s.typingUsers[channelId];
      if (!existing) return s;
      const entry = existing.find((e) => e.userId === userId);
      if (entry) clearTimeout(entry.timeout);
      const filtered = existing.filter((e) => e.userId !== userId);
      return {
        typingUsers: { ...s.typingUsers, [channelId]: filtered },
      };
    });
  },
}));
