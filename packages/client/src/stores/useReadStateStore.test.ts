import { describe, it, expect, beforeEach } from "vitest";
import { useReadStateStore } from "./useReadStateStore";

describe("useReadStateStore", () => {
  beforeEach(() => {
    useReadStateStore.setState({
      readStates: {},
      unreadChannels: {},
      mentionCounts: {},
    });
  });

  describe("markRead", () => {
    it("advances the read cursor and clears unread + mentions", () => {
      useReadStateStore.getState().setUnread("c1");
      useReadStateStore.getState().setMentioned("c1");
      useReadStateStore.getState().markRead("c1", "100");

      const s = useReadStateStore.getState();
      expect(s.readStates["c1"]).toBe("100");
      expect(s.unreadChannels["c1"]).toBe(false);
      expect(s.mentionCounts["c1"]).toBe(0);
    });
  });

  describe("initReadStates merge", () => {
    it("keeps local cursor when it is newer than the server value", () => {
      // Local state: user opened the channel and acked up to msg 200
      useReadStateStore.getState().markRead("c1", "200");

      // Server is behind (ack was delayed/lost): only knows up to 100
      useReadStateStore.getState().initReadStates([
        { channel_id: "c1", last_read_message_id: "100", last_message_id: "150" },
      ]);

      const s = useReadStateStore.getState();
      // Local cursor wins — channel must NOT resurrect as unread
      expect(s.readStates["c1"]).toBe("200");
      expect(s.unreadChannels["c1"] ?? false).toBe(false);
    });

    it("adopts server cursor when it is newer than local", () => {
      useReadStateStore.getState().markRead("c1", "100");

      useReadStateStore.getState().initReadStates([
        { channel_id: "c1", last_read_message_id: "200", last_message_id: "200" },
      ]);

      const s = useReadStateStore.getState();
      expect(s.readStates["c1"]).toBe("200");
      expect(s.unreadChannels["c1"] ?? false).toBe(false);
    });

    it("marks channel unread when server cursor is behind latest and local has no cursor", () => {
      useReadStateStore.getState().initReadStates([
        { channel_id: "c1", last_read_message_id: "100", last_message_id: "150" },
      ]);

      const s = useReadStateStore.getState();
      expect(s.readStates["c1"]).toBe("100");
      expect(s.unreadChannels["c1"]).toBe(true);
    });

    it("does not resurrect unread when local cursor equals latest message", () => {
      // Local acked up to the exact latest message
      useReadStateStore.getState().markRead("c1", "150");

      // Server still thinks cursor is at 100, latest is 150
      useReadStateStore.getState().initReadStates([
        { channel_id: "c1", last_read_message_id: "100", last_message_id: "150" },
      ]);

      const s = useReadStateStore.getState();
      expect(s.readStates["c1"]).toBe("150");
      expect(s.unreadChannels["c1"] ?? false).toBe(false);
    });

    it("preserves read state for channels not present in the server snapshot", () => {
      useReadStateStore.getState().markRead("c2", "500");

      useReadStateStore.getState().initReadStates([
        { channel_id: "c1", last_read_message_id: "100", last_message_id: "150" },
      ]);

      const s = useReadStateStore.getState();
      // c2 untouched, c1 added
      expect(s.readStates["c2"]).toBe("500");
      expect(s.readStates["c1"]).toBe("100");
    });

    it("keeps mention counts from the snapshot", () => {
      useReadStateStore.getState().initReadStates([
        { channel_id: "c1", last_read_message_id: "100", last_message_id: "150", mention_count: 3 },
      ]);

      expect(useReadStateStore.getState().mentionCounts["c1"]).toBe(3);
    });

    it("does not resurrect mention count on a locally-read channel", () => {
      // Local state: user already read c1 (mention badge cleared locally)
      useReadStateStore.getState().markRead("c1", "150");

      // Server is behind: still thinks cursor is at 100 and has a stale mention
      useReadStateStore.getState().initReadStates([
        { channel_id: "c1", last_read_message_id: "100", last_message_id: "150", mention_count: 3 },
      ]);

      const s = useReadStateStore.getState();
      expect(s.unreadChannels["c1"] ?? false).toBe(false);
      expect(s.mentionCounts["c1"] ?? 0).toBe(0);
    });
  });
});
