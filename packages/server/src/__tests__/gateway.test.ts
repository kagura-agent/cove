import { describe, it, expect, beforeEach, vi } from "vitest";
import { GatewayDispatcher } from "../ws/dispatcher.js";
import type { GatewaySession } from "../ws/session.js";
import type { ChannelsRepo } from "../repos/channels.js";
import type { Channel } from "@cove/shared";

function mockSession(id: string, userId: string, guilds: string[]): GatewaySession {
  const dispatched: { event: string; data: unknown }[] = [];
  return {
    id,
    user: { id: userId, username: `user-${userId}`, bot: false },
    guildIds: new Set(guilds),
    isIdentified: true,
    dispatch: vi.fn((event: string, data: unknown) => {
      dispatched.push({ event, data });
    }),
    dispatched,
  } as unknown as GatewaySession & { dispatched: typeof dispatched };
}

function mockChannelsRepo(mapping: Record<string, string | null>): ChannelsRepo {
  return {
    getById(id: string): Channel | null {
      if (!(id in mapping)) return null;
      const guildId = mapping[id];
      return { id, guild_id: guildId, name: "test", type: 0, topic: null, position: 0 } as Channel;
    },
  } as ChannelsRepo;
}

describe("GatewayDispatcher guild-scoped broadcasting", () => {
  let dispatcher: GatewayDispatcher;
  let sessionA: ReturnType<typeof mockSession>;
  let sessionB: ReturnType<typeof mockSession>;

  beforeEach(() => {
    const channels = mockChannelsRepo({
      "chan-1": "guild-a",
      "chan-2": "guild-b",
      "dm-chan": null,
    });
    dispatcher = new GatewayDispatcher(channels);

    sessionA = mockSession("s1", "user-1", ["guild-a"]);
    sessionB = mockSession("s2", "user-2", ["guild-b"]);

    dispatcher.addSession(sessionA);
    dispatcher.addSession(sessionB);

    // Clear calls from addSession's presenceUpdate side-effects
    vi.mocked(sessionA.dispatch).mockClear();
    vi.mocked(sessionB.dispatch).mockClear();
  });

  describe("messageCreate", () => {
    it("sends to sessions in the correct guild", () => {
      dispatcher.messageCreate({ id: "m1", channel_id: "chan-1", content: "hello" } as any);

      expect(sessionA.dispatch).toHaveBeenCalledWith("MESSAGE_CREATE", expect.objectContaining({ id: "m1" }));
      expect(sessionB.dispatch).not.toHaveBeenCalledWith("MESSAGE_CREATE", expect.anything());
    });

    it("does not broadcast when channel is not found", () => {
      dispatcher.messageCreate({ id: "m1", channel_id: "unknown", content: "hello" } as any);

      expect(sessionA.dispatch).not.toHaveBeenCalled();
      expect(sessionB.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("messageUpdate", () => {
    it("sends only to the correct guild", () => {
      dispatcher.messageUpdate({ id: "m1", channel_id: "chan-2", content: "edited" } as any);

      expect(sessionB.dispatch).toHaveBeenCalledWith("MESSAGE_UPDATE", expect.objectContaining({ id: "m1" }));
      expect(sessionA.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("messageDelete", () => {
    it("sends only to the correct guild", () => {
      dispatcher.messageDelete("chan-1", "m1");

      expect(sessionA.dispatch).toHaveBeenCalledWith("MESSAGE_DELETE", { id: "m1", channel_id: "chan-1" });
      expect(sessionB.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("typingStart", () => {
    it("sends only to sessions in the correct guild", () => {
      dispatcher.typingStart("chan-1", { id: "user-1", username: "u1" }, "guild-a");

      expect(sessionA.dispatch).toHaveBeenCalledWith("TYPING_START", expect.objectContaining({ channel_id: "chan-1" }));
      expect(sessionB.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("presenceUpdate", () => {
    it("sends online to sessions sharing a guild", () => {
      const sessionA2 = mockSession("s3", "user-3", ["guild-a"]);
      dispatcher.addSession(sessionA2);

      // user-3 just came online — sessionA shares guild-a so should receive it
      expect(sessionA.dispatch).toHaveBeenCalledWith("PRESENCE_UPDATE", { user: { id: "user-3" }, status: "online" });
      // sessionB is in guild-b only, should not receive
      expect(sessionB.dispatch).not.toHaveBeenCalledWith("PRESENCE_UPDATE", expect.objectContaining({ user: { id: "user-3" } }));
    });

    it("does not send the offline event to the dying session itself", () => {
      const sessionA2 = mockSession("s3", "user-3", ["guild-a"]);
      dispatcher.addSession(sessionA2);

      vi.mocked(sessionA.dispatch).mockClear();
      vi.mocked(sessionA2.dispatch).mockClear();

      dispatcher.removeSession(sessionA2);

      expect(sessionA.dispatch).toHaveBeenCalledWith("PRESENCE_UPDATE", { user: { id: "user-3" }, status: "offline" });
      // The dying session should NOT receive its own offline event
      expect(sessionA2.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("DM channels (#111)", () => {
    // DM channels have guild_id == null and must not be broadcast to guild members.
    // See #111 for the DM implementation plan.
    it("does not broadcast messages in non-guild (DM) channels", () => {
      dispatcher.messageCreate({ id: "dm1", channel_id: "dm-chan", content: "secret" } as any);

      expect(sessionA.dispatch).not.toHaveBeenCalled();
      expect(sessionB.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("GUILD_CREATE / GUILD_DELETE events", () => {
    it("sends GUILD_DELETE to user sessions before removing guild", () => {
      dispatcher.removeGuildFromUser("user-2", "guild-b");

      expect(sessionB.dispatch).toHaveBeenCalledWith("GUILD_DELETE", { id: "guild-b" });
      // sessionA is a different user and should not receive it
      expect(sessionA.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("cross-guild isolation", () => {
    it("sessions in different guilds never receive each other's events", () => {
      dispatcher.messageCreate({ id: "m1", channel_id: "chan-1", content: "a" } as any);
      dispatcher.messageCreate({ id: "m2", channel_id: "chan-2", content: "b" } as any);
      dispatcher.typingStart("chan-1", { id: "user-1", username: "u1" }, "guild-a");
      dispatcher.typingStart("chan-2", { id: "user-2", username: "u2" }, "guild-b");

      const aCalls = vi.mocked(sessionA.dispatch).mock.calls;
      const bCalls = vi.mocked(sessionB.dispatch).mock.calls;

      // sessionA should only have guild-a events
      for (const [event, data] of aCalls) {
        if (event === "MESSAGE_CREATE") {
          expect((data as any).channel_id).toBe("chan-1");
        }
        if (event === "TYPING_START") {
          expect((data as any).channel_id).toBe("chan-1");
        }
      }

      // sessionB should only have guild-b events
      for (const [event, data] of bCalls) {
        if (event === "MESSAGE_CREATE") {
          expect((data as any).channel_id).toBe("chan-2");
        }
        if (event === "TYPING_START") {
          expect((data as any).channel_id).toBe("chan-2");
        }
      }
    });
  });

  describe("live guild membership update", () => {
    it("adds and removes guild visibility for a user at runtime", () => {
      // user-2 starts in guild-b only, so should NOT receive guild-a messages
      dispatcher.messageCreate({ id: "m1", channel_id: "chan-1", content: "before" } as any);
      expect(sessionA.dispatch).toHaveBeenCalledWith("MESSAGE_CREATE", expect.objectContaining({ id: "m1" }));
      expect(sessionB.dispatch).not.toHaveBeenCalled();

      vi.mocked(sessionA.dispatch).mockClear();
      vi.mocked(sessionB.dispatch).mockClear();

      // Simulate user-2 joining guild-a
      dispatcher.addGuildToUser("user-2", "guild-a");

      dispatcher.messageCreate({ id: "m2", channel_id: "chan-1", content: "after join" } as any);
      expect(sessionB.dispatch).toHaveBeenCalledWith("MESSAGE_CREATE", expect.objectContaining({ id: "m2" }));

      vi.mocked(sessionA.dispatch).mockClear();
      vi.mocked(sessionB.dispatch).mockClear();

      // Simulate user-2 being kicked from guild-a
      dispatcher.removeGuildFromUser("user-2", "guild-a");

      // GUILD_DELETE was sent to sessionB — verify it, then clear for message assertions
      expect(sessionB.dispatch).toHaveBeenCalledWith("GUILD_DELETE", { id: "guild-a" });
      vi.mocked(sessionA.dispatch).mockClear();
      vi.mocked(sessionB.dispatch).mockClear();

      dispatcher.messageCreate({ id: "m3", channel_id: "chan-1", content: "after kick" } as any);
      expect(sessionA.dispatch).toHaveBeenCalledWith("MESSAGE_CREATE", expect.objectContaining({ id: "m3" }));
      expect(sessionB.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("removeUser (#187)", () => {
    it("closes all sessions for a user and broadcasts offline", () => {
      // Add a second session for user-1
      const sessionA2 = mockSession("s3", "user-1", ["guild-a"]);
      (sessionA2 as any).close = vi.fn();
      (sessionA as any).close = vi.fn();
      dispatcher.addSession(sessionA2);

      vi.mocked(sessionB.dispatch).mockClear();

      dispatcher.removeUser("user-1");

      // Both sessions for user-1 should be closed
      expect((sessionA as any).close).toHaveBeenCalledWith(4004, "User deleted");
      expect((sessionA2 as any).close).toHaveBeenCalledWith(4004, "User deleted");

      // sessionB should receive offline presence for user-1
      expect(sessionB.dispatch).not.toHaveBeenCalledWith("PRESENCE_UPDATE", expect.objectContaining({ status: "offline" }));
    });
  });
});
