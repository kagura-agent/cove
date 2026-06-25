import { create } from "zustand";
import type { Guild } from "../types";

interface GuildState {
  guilds: Record<string, Guild>;
  setGuilds: (guilds: Guild[]) => void;
  addGuild: (guild: Guild) => void;
  removeGuild: (id: string) => void;
}

export const useGuildStore = create<GuildState>((set) => ({
  guilds: {},
  setGuilds: (guilds) =>
    set({
      guilds: Object.fromEntries(guilds.map((g) => [g.id, g])),
    }),
  addGuild: (guild) =>
    set((s) => ({
      guilds: { ...s.guilds, [guild.id]: guild },
    })),
  removeGuild: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.guilds;
      return { guilds: rest };
    }),
}));
