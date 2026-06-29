import { describe, it, expect, beforeEach } from "vitest";
import { useGuildStore } from "./useGuildStore";

describe("useGuildStore", () => {
  beforeEach(() => {
    useGuildStore.setState({ guilds: {} });
  });

  it("renders all guilds from store", () => {
    useGuildStore.getState().setGuilds([
      { id: "g1", name: "Guild A", icon: null, owner_id: "u1", features: [] },
      { id: "g2", name: "Guild B", icon: null, owner_id: "u1", features: [] },
    ]);

    const guilds = useGuildStore.getState().guilds;
    expect(Object.keys(guilds)).toHaveLength(2);
    expect(guilds["g1"].name).toBe("Guild A");
    expect(guilds["g2"].name).toBe("Guild B");
  });

  it("addGuild adds a new guild", () => {
    useGuildStore.getState().addGuild({ id: "g1", name: "New", icon: null, owner_id: "u1", features: [] });
    expect(useGuildStore.getState().guilds["g1"]).toBeDefined();
    expect(useGuildStore.getState().guilds["g1"].name).toBe("New");
  });

  it("updateGuild updates guild fields", () => {
    useGuildStore.getState().setGuilds([
      { id: "g1", name: "Original", icon: null, owner_id: "u1", features: [] },
    ]);
    useGuildStore.getState().updateGuild("g1", { name: "Updated" });
    expect(useGuildStore.getState().guilds["g1"].name).toBe("Updated");
    // owner_id unchanged
    expect(useGuildStore.getState().guilds["g1"].owner_id).toBe("u1");
  });

  it("removeGuild removes guild", () => {
    useGuildStore.getState().setGuilds([
      { id: "g1", name: "Guild A", icon: null, owner_id: "u1", features: [] },
      { id: "g2", name: "Guild B", icon: null, owner_id: "u1", features: [] },
    ]);
    useGuildStore.getState().removeGuild("g1");
    expect(useGuildStore.getState().guilds["g1"]).toBeUndefined();
    expect(useGuildStore.getState().guilds["g2"]).toBeDefined();
  });

  it("updateGuild on non-existent guild is no-op", () => {
    useGuildStore.getState().updateGuild("nonexistent", { name: "Whatever" });
    expect(Object.keys(useGuildStore.getState().guilds)).toHaveLength(0);
  });
});
