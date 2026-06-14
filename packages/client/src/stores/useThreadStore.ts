import { create } from "zustand";
import type { Channel, Message } from "../types";
import * as api from "../lib/api";

interface ThreadState {
  // Currently open thread panel
  activeThread: Channel | null;
  threadMessages: Message[];
  threadMessagesLoading: boolean;

  // Thread list for a channel (active threads)
  threads: Record<string, Channel[]>; // channelId -> threads

  // Actions
  openThread: (thread: Channel) => void;
  closeThread: () => void;
  loadThreadMessages: (threadId: string) => Promise<void>;
  loadMoreThreadMessages: (threadId: string) => Promise<boolean>; // returns hasMore
  addThreadMessage: (msg: Message) => void;
  removeThreadMessage: (msgId: string) => void;
  setThreads: (channelId: string, threads: Channel[]) => void;
  addThread: (thread: Channel) => void;
  updateThread: (thread: Channel) => void;
  removeThread: (threadId: string) => void;
  sendMessage: (threadId: string, content: string) => Promise<void>;
}

export const useThreadStore = create<ThreadState>((set, get) => ({
  activeThread: null,
  threadMessages: [],
  threadMessagesLoading: false,
  threads: {},

  openThread: (thread) => {
    set({ activeThread: thread, threadMessages: [], threadMessagesLoading: true });
    get().loadThreadMessages(thread.id);
  },

  closeThread: () => set({ activeThread: null, threadMessages: [] }),

  loadThreadMessages: async (threadId) => {
    set({ threadMessagesLoading: true });
    try {
      const messages = await api.fetchMessages(threadId, { limit: 50 });
      set({ threadMessages: messages, threadMessagesLoading: false });
    } catch {
      set({ threadMessagesLoading: false });
    }
  },

  loadMoreThreadMessages: async (threadId) => {
    const { threadMessages } = get();
    if (threadMessages.length === 0) return false;
    const oldest = threadMessages[0];
    try {
      const older = await api.fetchMessages(threadId, { before: oldest.id, limit: 50 });
      if (older.length === 0) return false;
      set({ threadMessages: [...older, ...threadMessages] });
      return older.length >= 50;
    } catch {
      return false;
    }
  },

  addThreadMessage: (msg) => {
    const { activeThread } = get();
    if (!activeThread || msg.channel_id !== activeThread.id) return;
    set((s) => ({ threadMessages: [...s.threadMessages, msg] }));
  },

  removeThreadMessage: (msgId) => {
    set((s) => ({ threadMessages: s.threadMessages.filter((m) => m.id !== msgId) }));
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
      return { threads: { ...s.threads, [thread.parent_id!]: existing.map((t) => t.id === thread.id ? thread : t) } };
    });
    const { activeThread } = get();
    if (activeThread && activeThread.id === thread.id) {
      set({ activeThread: thread });
    }
  },

  removeThread: (threadId) => {
    set((s) => {
      const newThreads = { ...s.threads };
      for (const channelId of Object.keys(newThreads)) {
        newThreads[channelId] = newThreads[channelId].filter((t) => t.id !== threadId);
      }
      return { threads: newThreads, activeThread: s.activeThread?.id === threadId ? null : s.activeThread };
    });
  },

  sendMessage: async (threadId, content) => {
    const nonce = crypto.randomUUID();
    await api.sendMessage(threadId, content, nonce);
  },
}));
