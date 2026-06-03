import { create } from "zustand";

interface PresenceState {
  onlineUsers: Set<string>;
  setOnline: (userId: string) => void;
  setOffline: (userId: string) => void;
  isOnline: (userId: string) => boolean;
  initPresences: (userIds: string[]) => void;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  onlineUsers: new Set<string>(),
  setOnline: (userId) =>
    set((s) => {
      const next = new Set(s.onlineUsers);
      next.add(userId);
      return { onlineUsers: next };
    }),
  setOffline: (userId) =>
    set((s) => {
      const next = new Set(s.onlineUsers);
      next.delete(userId);
      return { onlineUsers: next };
    }),
  isOnline: (userId) => get().onlineUsers.has(userId),
  initPresences: (userIds) => set({ onlineUsers: new Set(userIds) }),
}));
