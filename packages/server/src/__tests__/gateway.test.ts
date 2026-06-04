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

function mockChannelsRepo(mapping: Record<string, string>): ChannelsRepo {
  return {
    getById(id: string): Channel | null {
      const guildId = mapping[id];
      if (!guildId) return null;
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

    it("sends offline only to sessions sharing a guild", () => {
      const sessionA2 = mockSession("s3", "user-3", ["guild-a"]);
      dispatcher.addSession(sessionA2);

      // Clear mocks from the online event
      vi.mocked(sessionA.dispatch).mockClear();
      vi.mocked(sessionB.dispatch).mockClear();

      dispatcher.removeSession(sessionA2);

      expect(sessionA.dispatch).toHaveBeenCalledWith("PRESENCE_UPDATE", { user: { id: "user-3" }, status: "offline" });
      expect(sessionB.dispatch).not.toHaveBeenCalled();
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
});
