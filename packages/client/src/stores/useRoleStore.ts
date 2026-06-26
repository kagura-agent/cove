import { create } from "zustand";
import type { Role } from "@cove/shared";

interface RoleState {
  roles: Record<string, Role[]>; // guildId → roles sorted by position desc

  setRoles: (guildId: string, roles: Role[]) => void;
  addRole: (guildId: string, role: Role) => void;
  updateRole: (guildId: string, role: Role) => void;
  removeRole: (guildId: string, roleId: string) => void;
}

function sortRoles(roles: Role[]): Role[] {
  return [...roles].sort((a, b) => b.position - a.position || b.id.localeCompare(a.id));
}

export const useRoleStore = create<RoleState>((set, get) => ({
  roles: {},

  setRoles: (guildId, roles) =>
    set((state) => ({
      roles: { ...state.roles, [guildId]: sortRoles(roles) },
    })),

  addRole: (guildId, role) =>
    set((state) => {
      const existing = state.roles[guildId] ?? [];
      // Idempotent: if role already exists, update it instead of duplicating
      if (existing.some((r) => r.id === role.id)) {
        return { roles: { ...state.roles, [guildId]: sortRoles(existing.map((r) => r.id === role.id ? role : r)) } };
      }
      return { roles: { ...state.roles, [guildId]: sortRoles([...existing, role]) } };
    }),

  updateRole: (guildId, role) =>
    set((state) => {
      const existing = state.roles[guildId] ?? [];
      const updated = existing.map((r) => (r.id === role.id ? role : r));
      return { roles: { ...state.roles, [guildId]: sortRoles(updated) } };
    }),

  removeRole: (guildId, roleId) =>
    set((state) => {
      const existing = state.roles[guildId] ?? [];
      return { roles: { ...state.roles, [guildId]: existing.filter((r) => r.id !== roleId) } };
    }),
}));
