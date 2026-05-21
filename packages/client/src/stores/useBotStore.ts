import { create } from "zustand";
import type { Bot, BotCreateResponse } from "../types";
import * as api from "../lib/api";

interface BotState {
  bots: Bot[];
  fetchBots: () => Promise<void>;
  createBot: (name: string, emoji: string, bio: string) => Promise<BotCreateResponse>;
  deleteBot: (id: string) => Promise<void>;
}

export const useBotStore = create<BotState>((set) => ({
  bots: [],
  fetchBots: async () => {
    const members = await api.fetchBots();
    set({ bots: members.filter((m) => m.bot) });
  },
  createBot: async (name, emoji, bio) => {
    const result = await api.createBot(name, emoji, bio);
    const members = await api.fetchBots();
    set({ bots: members.filter((m) => m.bot) });
    return result;
  },
  deleteBot: async (id) => {
    await api.deleteBot(id);
    set((s) => ({ bots: s.bots.filter((b) => b.id !== id) }));
  },
}));
