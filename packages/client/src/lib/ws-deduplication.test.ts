/**
 * Integration test: verifies that optimistic update + WS event
 * does not cause duplicate entries in stores.
 *
 * Uses the REAL store implementations (not mocked).
 * Simulates the WS handler by calling addRole directly (since the handler
 * just delegates to addRole — testing the store's idempotency is what matters).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useRoleStore } from "../stores/useRoleStore";
import { useMemberStore } from "../stores/useMemberStore";
import type { Role } from "@cove/shared";

const GUILD_ID = "guild-1";

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-1",
    name: "Test Role",
    position: 1,
    permissions: "0",
    color: 0,
    hoist: false,
    managed: false,
    mentionable: false,
    flags: 0,
    bot_id: null,
    ...overrides,
  };
}

describe("optimistic update + WS event deduplication", () => {
  beforeEach(() => {
    useRoleStore.setState({ roles: {} });
    useMemberStore.setState({ membersByGuildId: {} });
  });

  describe("GUILD_ROLE_CREATE pattern", () => {
    it("does not duplicate when component adds role then WS handler adds same role", () => {
      // 1. Component optimistically adds role after API success
      const role = makeRole({ id: "new-role", name: "Moderator", position: 2 });
      useRoleStore.getState().addRole(GUILD_ID, role);

      // 2. WS GUILD_ROLE_CREATE handler calls addRole with same role
      useRoleStore.getState().addRole(GUILD_ID, role);

      // 3. Store should have exactly 1 role, not 2
      const stored = useRoleStore.getState().roles[GUILD_ID];
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe("new-role");
    });

    it("WS handler updates role data even if already present", () => {
      // Component adds with client-side data
      const clientRole = makeRole({ id: "new-role", name: "new role", position: 1 });
      useRoleStore.getState().addRole(GUILD_ID, clientRole);

      // WS handler adds with server-authoritative data (e.g., corrected position)
      const serverRole = makeRole({ id: "new-role", name: "new role", position: 5 });
      useRoleStore.getState().addRole(GUILD_ID, serverRole);

      const stored = useRoleStore.getState().roles[GUILD_ID];
      expect(stored).toHaveLength(1);
      expect(stored[0].position).toBe(5);
    });
  });

  describe("GUILD_MEMBER_UPDATE pattern", () => {
    it("does not duplicate member when optimistic update + WS upsert", () => {
      // Setup: member exists in store
      useMemberStore.getState().upsertMember(GUILD_ID, {
        user: { id: "user-1", username: "Luna", avatar: null, bot: false, discriminator: "0", global_name: null },
        nick: null,
        roles: ["role-a"],
        joined_at: "2026-01-01",
      });

      // 1. Component optimistically updates roles
      useMemberStore.getState().upsertMember(GUILD_ID, {
        user: { id: "user-1", username: "Luna", avatar: null, bot: false, discriminator: "0", global_name: null },
        nick: null,
        roles: ["role-a", "role-b"],
        joined_at: "2026-01-01",
      });

      // 2. WS handler also upserts same member
      useMemberStore.getState().upsertMember(GUILD_ID, {
        user: { id: "user-1", username: "Luna", avatar: null, bot: false, discriminator: "0", global_name: null },
        nick: null,
        roles: ["role-a", "role-b"],
        joined_at: "2026-01-01",
      });

      // 3. Should still be exactly 1 member with correct roles
      const members = useMemberStore.getState().membersByGuildId[GUILD_ID];
      const memberIds = Object.keys(members);
      expect(memberIds).toHaveLength(1);
      expect(members["user-1"].roles).toEqual(["role-a", "role-b"]);
    });
  });
});
