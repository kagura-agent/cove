import { create } from "zustand";
import type { GuildMember } from "../types";
import * as api from "../lib/api";

interface MemberState {
  membersByGuildId: Record<string, Record<string, GuildMember>>;
  fetchMembers: (guildId: string) => Promise<void>;
  upsertMember: (guildId: string, member: GuildMember) => void;
  removeMember: (guildId: string, userId: string) => void;
  getMembers: (guildId: string) => GuildMember[];
  setMembers: (guildId: string, members: GuildMember[]) => void;
}

export const useMemberStore = create<MemberState>((set, get) => ({
  membersByGuildId: {},
  fetchMembers: async (guildId) => {
    const members = await api.fetchMembers(guildId);
    set((s) => ({
      membersByGuildId: {
        ...s.membersByGuildId,
        [guildId]: Object.fromEntries(members.map((m) => [m.user.id, m])),
      },
    }));
  },
  upsertMember: (guildId, member) =>
    set((s) => ({
      membersByGuildId: {
        ...s.membersByGuildId,
        [guildId]: {
          ...(s.membersByGuildId[guildId] ?? {}),
          [member.user.id]: member,
        },
      },
    })),
  removeMember: (guildId, userId) =>
    set((s) => {
      const guildMembers = s.membersByGuildId[guildId];
      if (!guildMembers) return s;
      const { [userId]: _, ...rest } = guildMembers;
      return {
        membersByGuildId: {
          ...s.membersByGuildId,
          [guildId]: rest,
        },
      };
    }),
  getMembers: (guildId) => Object.values(get().membersByGuildId[guildId] ?? {}),
  setMembers: (guildId, members) =>
    set((s) => ({
      membersByGuildId: {
        ...s.membersByGuildId,
        [guildId]: Object.fromEntries(members.map((m) => [m.user.id, m])),
      },
    })),
}));
