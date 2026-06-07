import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatcher } from "./gateway-dispatcher";

// Mock all stores
vi.mock("../stores/useMessageStore", () => ({
  useMessageStore: { getState: vi.fn(() => ({ addMessage: vi.fn(), updateMessage: vi.fn(), removeMessage: vi.fn() })) },
}));
vi.mock("../stores/useChannelStore", () => ({
  useChannelStore: { getState: vi.fn(() => ({ activeChannelId: "c1", addChannel: vi.fn(), updateChannel: vi.fn(), removeChannel: vi.fn(), setChannels: vi.fn(), setActiveChannel: vi.fn(), removeGuildChannels: vi.fn() })) },
}));
vi.mock("../stores/usePresenceStore", () => ({
  usePresenceStore: { getState: vi.fn(() => ({ setOnline: vi.fn(), setOffline: vi.fn(), initPresences: vi.fn() })) },
}));
vi.mock("../stores/useUserStore", () => ({
  useUserStore: { getState: vi.fn(() => ({ id: "self", setUser: vi.fn() })) },
}));
vi.mock("../stores/useTypingStore", () => ({
  useTypingStore: {
    getState: vi.fn(() => ({ clearTyping: vi.fn() })),
    setState: vi.fn(),
  },
  typingTimeoutIds: new Set(),
}));
vi.mock("../stores/useReadStateStore", () => ({
  useReadStateStore: { getState: vi.fn(() => ({ initReadStates: vi.fn(), setUnread: vi.fn(), markRead: vi.fn(), removeChannel: vi.fn() })) },
}));
vi.mock("../stores/useGuildStore", () => ({
  useGuildStore: { getState: vi.fn(() => ({ setGuilds: vi.fn(), setActiveGuild: vi.fn(), addGuild: vi.fn(), removeGuild: vi.fn() })) },
}));
vi.mock("../stores/useMemberStore", () => ({
  useMemberStore: { getState: vi.fn(() => ({ upsertMember: vi.fn(), removeMember: vi.fn() })) },
}));
vi.mock("./api", () => ({
  ackMessage: vi.fn(() => Promise.resolve()),
}));

import { setupGatewaySubscriptions, teardownGatewaySubscriptions } from "./gateway-subscriptions";
import { useMessageStore } from "../stores/useMessageStore";

describe("gateway-subscriptions", () => {
  beforeEach(() => {
    teardownGatewaySubscriptions();
    vi.clearAllMocks();
  });

  it("setup is idempotent — calling twice doesn't duplicate handlers", () => {
    const addMessage = vi.fn();
    vi.mocked(useMessageStore.getState).mockReturnValue({
      addMessage,
      updateMessage: vi.fn(),
      removeMessage: vi.fn(),
      setMessages: vi.fn(),
      messages: {},
    } as never);

    setupGatewaySubscriptions();
    setupGatewaySubscriptions();

    dispatcher.emit("MESSAGE_CREATE", {
      id: "1",
      channel_id: "c1",
      content: "hi",
      author: { id: "u1", username: "u1" },
      timestamp: new Date().toISOString(),
    } as never);

    expect(addMessage).toHaveBeenCalledTimes(1);
  });

  it("teardown clears all handlers — emit after teardown does nothing", () => {
    const addMessage = vi.fn();
    vi.mocked(useMessageStore.getState).mockReturnValue({
      addMessage,
      updateMessage: vi.fn(),
      removeMessage: vi.fn(),
      setMessages: vi.fn(),
      messages: {},
    } as never);

    setupGatewaySubscriptions();
    teardownGatewaySubscriptions();

    dispatcher.emit("MESSAGE_CREATE", {
      id: "1",
      channel_id: "c1",
      content: "hi",
      author: { id: "u1", username: "u1" },
      timestamp: new Date().toISOString(),
    } as never);

    expect(addMessage).not.toHaveBeenCalled();
  });
});
