import { create } from "zustand";
import type { Channel } from "../types";

interface ChannelState {
  channels: Channel[];
  activeChannelId: string | null;
  setChannels: (channels: Channel[]) => void;
  setActiveChannel: (id: string | null) => void;
  addChannel: (channel: Channel) => void;
  removeChannel: (id: string) => void;
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: [],
  activeChannelId: null,
  setChannels: (channels) => set({ channels }),
  setActiveChannel: (id) => set({ activeChannelId: id }),
  addChannel: (channel) => set((s) => ({ channels: [...s.channels, channel] })),
  removeChannel: (id) => set((s) => ({
    channels: s.channels.filter((c) => c.id !== id),
    activeChannelId: s.activeChannelId === id ? null : s.activeChannelId,
  })),
}));
