import { create } from "zustand";
import type { Guild } from "../types";

interface GuildState {
  guilds: Record<string, Guild>;
  activeGuildId: string | null;
  setGuilds: (guilds: Guild[]) => void;
  setActiveGuild: (id: string | null) => void;
  addGuild: (guild: Guild) => void;
  removeGuild: (id: string) => void;
}

export const useGuildStore = create<GuildState>((set) => ({
  guilds: {},
  activeGuildId: null,
  setGuilds: (guilds) =>
    set({
      guilds: Object.fromEntries(guilds.map((g) => [g.id, g])),
    }),
  setActiveGuild: (id) => set({ activeGuildId: id }),
  addGuild: (guild) =>
    set((s) => ({
      guilds: { ...s.guilds, [guild.id]: guild },
    })),
  removeGuild: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.guilds;
      return {
        guilds: rest,
        activeGuildId: s.activeGuildId === id ? null : s.activeGuildId,
      };
    }),
}));
