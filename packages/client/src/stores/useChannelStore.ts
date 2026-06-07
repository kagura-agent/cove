import { create } from "zustand";
import type { Channel } from "../types";

interface ChannelState {
  channels: Channel[];
  activeChannelId: string | null;
  channelsLoaded: boolean;
  setChannels: (channels: Channel[]) => void;
  setActiveChannel: (id: string | null) => void;
  addChannel: (channel: Channel) => void;
  updateChannel: (channel: Channel) => void;
  removeChannel: (id: string) => void;
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: [],
  activeChannelId: null,
  channelsLoaded: false,
  setChannels: (channels) => set({ channels, channelsLoaded: true }),
  setActiveChannel: (id) => set({ activeChannelId: id }),
  addChannel: (channel) => set((s) => (
    s.channels.some((c) => c.id === channel.id)
      ? s
      : { channels: [...s.channels, channel] }
  )),
  updateChannel: (channel) => set((s) => ({
    channels: s.channels.map((c) => c.id === channel.id ? channel : c),
  })),
  removeChannel: (id) => set((s) => ({
    channels: s.channels.filter((c) => c.id !== id),
    activeChannelId: s.activeChannelId === id ? null : s.activeChannelId,
  })),
}));
