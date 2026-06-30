import { create } from "zustand";
import type { Guild } from "../types";

interface GuildState {
  guilds: Record<string, Guild>;
  gatewayReady: boolean;
  setGuilds: (guilds: Guild[]) => void;
  setGatewayReady: () => void;
  addGuild: (guild: Guild) => void;
  updateGuild: (id: string, data: Partial<Guild>) => void;
  removeGuild: (id: string) => void;
}

export const useGuildStore = create<GuildState>((set) => ({
  guilds: {},
  gatewayReady: false,
  setGuilds: (guilds) =>
    set({
      guilds: Object.fromEntries(guilds.map((g) => [g.id, g])),
      gatewayReady: true,
    }),
  setGatewayReady: () => set({ gatewayReady: true }),
  addGuild: (guild) =>
    set((s) => ({
      guilds: { ...s.guilds, [guild.id]: guild },
    })),
  updateGuild: (id, data) =>
    set((s) => {
      const existing = s.guilds[id];
      if (!existing) return s;
      return { guilds: { ...s.guilds, [id]: { ...existing, ...data } } };
    }),
  removeGuild: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.guilds;
      return { guilds: rest };
    }),
}));
