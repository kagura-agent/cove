import { create } from "zustand";
import type { Scene } from "../lib/api";

interface SceneState {
  scenesByGuildId: Record<string, Scene[]>;
  setScenes: (guildId: string, scenes: Scene[]) => void;
  addScene: (guildId: string, scene: Scene) => void;
  removeScene: (guildId: string, sceneId: string) => void;
  removeChannelFromScenes: (channelId: string) => void;
  getScenes: (guildId: string | null) => Scene[];
  getScenesForChannel: (channelId: string) => Scene[];
}

export const useSceneStore = create<SceneState>((set, get) => ({
  scenesByGuildId: {},

  setScenes: (guildId, scenes) =>
    set((s) => ({
      scenesByGuildId: { ...s.scenesByGuildId, [guildId]: scenes },
    })),

  addScene: (guildId, scene) =>
    set((s) => ({
      scenesByGuildId: {
        ...s.scenesByGuildId,
        [guildId]: [...(s.scenesByGuildId[guildId] ?? []), scene],
      },
    })),

  removeScene: (guildId, sceneId) =>
    set((s) => ({
      scenesByGuildId: {
        ...s.scenesByGuildId,
        [guildId]: (s.scenesByGuildId[guildId] ?? []).filter((sc) => sc.id !== sceneId),
      },
    })),

  removeChannelFromScenes: (channelId) =>
    set((s) => {
      const updated: Record<string, Scene[]> = {};
      for (const [guildId, scenes] of Object.entries(s.scenesByGuildId)) {
        updated[guildId] = scenes.map((sc) => ({
          ...sc,
          channels: sc.channels.filter((ch) => ch.id !== channelId),
        }));
      }
      return { scenesByGuildId: updated };
    }),

  getScenes: (guildId) => {
    if (!guildId) return [];
    return get().scenesByGuildId[guildId] ?? [];
  },

  getScenesForChannel: (channelId) => {
    const all = Object.values(get().scenesByGuildId).flat();
    return all.filter((sc) => sc.channels.some((ch) => ch.id === channelId));
  },
}));
