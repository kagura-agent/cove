import { describe, it, expect, beforeEach } from "vitest";
import { useRoleStore } from "./useRoleStore";
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

describe("useRoleStore", () => {
  beforeEach(() => {
    useRoleStore.setState({ roles: {} });
  });

  describe("setRoles", () => {
    it("sets roles sorted by position descending", () => {
      const roles = [
        makeRole({ id: "r1", position: 1 }),
        makeRole({ id: "r3", position: 3 }),
        makeRole({ id: "r2", position: 2 }),
      ];
      useRoleStore.getState().setRoles(GUILD_ID, roles);
      const stored = useRoleStore.getState().roles[GUILD_ID];
      expect(stored.map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
    });
  });

  describe("addRole", () => {
    it("adds a new role", () => {
      const role = makeRole({ id: "r1", position: 1 });
      useRoleStore.getState().addRole(GUILD_ID, role);
      const stored = useRoleStore.getState().roles[GUILD_ID];
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe("r1");
    });

    it("is idempotent — adding same ID twice does NOT duplicate", () => {
      const role = makeRole({ id: "r1", position: 1 });
      useRoleStore.getState().addRole(GUILD_ID, role);
      useRoleStore.getState().addRole(GUILD_ID, role);
      const stored = useRoleStore.getState().roles[GUILD_ID];
      expect(stored).toHaveLength(1);
    });

    it("updates role data when adding with existing ID", () => {
      const role = makeRole({ id: "r1", name: "Original", position: 1 });
      useRoleStore.getState().addRole(GUILD_ID, role);
      const updated = makeRole({ id: "r1", name: "Updated", position: 2 });
      useRoleStore.getState().addRole(GUILD_ID, updated);
      const stored = useRoleStore.getState().roles[GUILD_ID];
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe("Updated");
      expect(stored[0].position).toBe(2);
    });

    it("handles optimistic + WS pattern: API add then WS add = no duplicate", () => {
      // Simulates: component calls addRole after API, then WS GUILD_ROLE_CREATE fires
      const apiResponse = makeRole({ id: "new-role", name: "new role", position: 3 });
      const wsEvent = makeRole({ id: "new-role", name: "new role", position: 3 });
      useRoleStore.getState().addRole(GUILD_ID, apiResponse);
      useRoleStore.getState().addRole(GUILD_ID, wsEvent);
      const stored = useRoleStore.getState().roles[GUILD_ID];
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe("new-role");
    });
  });

  describe("updateRole", () => {
    it("updates an existing role", () => {
      useRoleStore.getState().setRoles(GUILD_ID, [makeRole({ id: "r1", name: "Old" })]);
      useRoleStore.getState().updateRole(GUILD_ID, makeRole({ id: "r1", name: "New" }));
      const stored = useRoleStore.getState().roles[GUILD_ID];
      expect(stored[0].name).toBe("New");
    });
  });

  describe("removeRole", () => {
    it("removes a role by ID", () => {
      useRoleStore.getState().setRoles(GUILD_ID, [
        makeRole({ id: "r1" }),
        makeRole({ id: "r2", position: 2 }),
      ]);
      useRoleStore.getState().removeRole(GUILD_ID, "r1");
      const stored = useRoleStore.getState().roles[GUILD_ID];
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe("r2");
    });
  });
});
