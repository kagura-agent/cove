import { create } from "zustand";
import type { Channel } from "../types";

interface ChannelState {
  channelsByGuildId: Record<string, Channel[]>;
  activeChannelId: string | null;
  channelsLoaded: boolean;

  /** Get channels for a specific guild */
  getChannels: (guildId: string | null) => Channel[];

  /** Set channels for a specific guild */
  setChannels: (guildId: string, channels: Channel[]) => void;
  setActiveChannel: (id: string | null) => void;
  addChannel: (channel: Channel) => void;
  updateChannel: (channel: Channel) => void;
  removeChannel: (id: string) => void;
  /** Remove all channels for a guild (cascade on guild delete) */
  removeGuildChannels: (guildId: string) => void;
}

export const useChannelStore = create<ChannelState>((set, get) => ({
  channelsByGuildId: {},
  activeChannelId: null,
  channelsLoaded: false,

  getChannels: (guildId) => {
    if (!guildId) return [];
    return get().channelsByGuildId[guildId] ?? [];
  },

  setChannels: (guildId, channels) =>
    set((s) => ({
      channelsByGuildId: { ...s.channelsByGuildId, [guildId]: channels },
      channelsLoaded: true,
    })),

  setActiveChannel: (id) => set({ activeChannelId: id }),

  addChannel: (channel) =>
    set((s) => {
      const guildId = channel.guild_id;
      if (!guildId) return s;
      const existing = s.channelsByGuildId[guildId] ?? [];
      if (existing.some((c) => c.id === channel.id)) return s;
      return {
        channelsByGuildId: {
          ...s.channelsByGuildId,
          [guildId]: [...existing, channel],
        },
      };
    }),

  updateChannel: (channel) =>
    set((s) => {
      const guildId = channel.guild_id;
      if (!guildId) return s;
      const existing = s.channelsByGuildId[guildId] ?? [];
      return {
        channelsByGuildId: {
          ...s.channelsByGuildId,
          [guildId]: existing.map((c) => (c.id === channel.id ? channel : c)),
        },
      };
    }),

  removeChannel: (id) =>
    set((s) => {
      const newByGuild = { ...s.channelsByGuildId };
      for (const guildId of Object.keys(newByGuild)) {
        const channels = newByGuild[guildId];
        if (channels.some((c) => c.id === id)) {
          newByGuild[guildId] = channels.filter((c) => c.id !== id);
          break;
        }
      }
      return {
        channelsByGuildId: newByGuild,
        activeChannelId: s.activeChannelId === id ? null : s.activeChannelId,
      };
    }),

  removeGuildChannels: (guildId) =>
    set((s) => {
      const { [guildId]: _, ...rest } = s.channelsByGuildId;
      return { channelsByGuildId: rest };
    }),
}));
