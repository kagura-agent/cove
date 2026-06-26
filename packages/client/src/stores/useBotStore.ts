import { create } from "zustand";
import type { Bot, BotCreateResponse } from "../types";
import * as api from "../lib/api";
import { useMemberStore } from "./useMemberStore";
import { getActiveIdsFromRouter } from "../lib/router-helpers";

interface BotState {
  bots: Bot[];
  fetchBots: () => Promise<void>;
  createBot: (name: string, bio: string) => Promise<BotCreateResponse>;
  deleteBot: (id: string) => Promise<void>;
}

export const useBotStore = create<BotState>((set) => ({
  bots: [],
  fetchBots: async () => {
    const { guildId } = getActiveIdsFromRouter();
    if (!guildId) return;
    // Fetch members into MemberStore, then derive bots
    await useMemberStore.getState().fetchMembers(guildId);
    const members = useMemberStore.getState().getMembers(guildId);
    set({ bots: members.filter((m) => m.user.bot).map((m) => m.user) });
  },
  createBot: async (name, bio) => {
    const result = await api.createBot(name, bio);
    set((s) => ({ bots: [...s.bots, { id: result.id, username: result.username, avatar: null, bio: result.bio, bot: true, discriminator: "0", global_name: null }] }));
    return result;
  },
  deleteBot: async (id) => {
    await api.deleteBot(id);
    set((s) => ({ bots: s.bots.filter((b) => b.id !== id) }));
  },
}));
