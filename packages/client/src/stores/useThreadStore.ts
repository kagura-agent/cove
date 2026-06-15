import { create } from "zustand";
import type { Channel } from "../types";
import * as api from "../lib/api";

interface ThreadState {
  activeThread: Channel | null;
  threads: Record<string, Channel[]>; // parentChannelId -> threads

  openThread: (thread: Channel) => void;
  closeThread: () => void;
  fetchAndOpenThread: (threadId: string) => Promise<void>;
  setThreads: (channelId: string, threads: Channel[]) => void;
  addThread: (thread: Channel) => void;
  updateThread: (thread: Channel) => void;
  removeThread: (threadId: string) => void;
}

export const useThreadStore = create<ThreadState>((set, get) => ({
  activeThread: null,
  threads: {},

  openThread: (thread) => set({ activeThread: thread }),
  closeThread: () => set({ activeThread: null }),

  fetchAndOpenThread: async (threadId) => {
    try {
      const channel = await api.fetchChannel(threadId);
      set({ activeThread: channel });
    } catch (err) {
      console.error("fetch thread:", err);
    }
  },

  setThreads: (channelId, threads) => {
    set((s) => ({ threads: { ...s.threads, [channelId]: threads } }));
  },

  addThread: (thread) => {
    if (!thread.parent_id) return;
    set((s) => {
      const existing = s.threads[thread.parent_id!] ?? [];
      if (existing.some((t) => t.id === thread.id)) return s;
      return { threads: { ...s.threads, [thread.parent_id!]: [...existing, thread] } };
    });
  },

  updateThread: (thread) => {
    if (!thread.parent_id) return;
    set((s) => {
      const existing = s.threads[thread.parent_id!] ?? [];
      return {
        threads: { ...s.threads, [thread.parent_id!]: existing.map((t) => t.id === thread.id ? thread : t) },
        activeThread: s.activeThread?.id === thread.id ? thread : s.activeThread,
      };
    });
  },

  removeThread: (threadId) => {
    set((s) => {
      const newThreads = { ...s.threads };
      for (const channelId of Object.keys(newThreads)) {
        newThreads[channelId] = newThreads[channelId].filter((t) => t.id !== threadId);
      }
      return {
        threads: newThreads,
        activeThread: s.activeThread?.id === threadId ? null : s.activeThread,
      };
    });
  },
}));
