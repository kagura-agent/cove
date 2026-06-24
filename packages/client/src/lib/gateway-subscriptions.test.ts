import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatcher } from "./gateway-dispatcher";

// Mock all stores
vi.mock("../stores/useMessageStore", () => ({
  useMessageStore: { getState: vi.fn(() => ({ addMessage: vi.fn(), updateMessage: vi.fn(), removeMessage: vi.fn(), removeChannelMessages: vi.fn(), setMessageThread: vi.fn() })) },
}));
vi.mock("../stores/useChannelStore", () => ({
  useChannelStore: { getState: vi.fn(() => ({ addChannel: vi.fn(), updateChannel: vi.fn(), removeChannel: vi.fn(), setChannels: vi.fn(), removeGuildChannels: vi.fn(), getChannels: vi.fn(() => []), channelsByGuildId: {} })) },
}));
vi.mock("../stores/usePresenceStore", () => ({
  usePresenceStore: { getState: vi.fn(() => ({ setOnline: vi.fn(), setOffline: vi.fn(), initPresences: vi.fn() })) },
}));
vi.mock("../stores/useUserStore", () => ({
  useUserStore: { getState: vi.fn(() => ({ id: "self", setUser: vi.fn() })) },
}));
vi.mock("../stores/useTypingStore", () => ({
  useTypingStore: {
    getState: vi.fn(() => ({ clearTyping: vi.fn(), removeChannel: vi.fn() })),
    setState: vi.fn(),
  },
  typingTimeoutIds: new Set(),
}));
vi.mock("../stores/useReadStateStore", () => ({
  useReadStateStore: { getState: vi.fn(() => ({ initReadStates: vi.fn(), setUnread: vi.fn(), markRead: vi.fn(), removeChannel: vi.fn() })) },
}));
vi.mock("../stores/useGuildStore", () => ({
  useGuildStore: { getState: vi.fn(() => ({ setGuilds: vi.fn(), addGuild: vi.fn(), removeGuild: vi.fn(), guilds: {} })) },
}));
vi.mock("../stores/useMemberStore", () => ({
  useMemberStore: { getState: vi.fn(() => ({ upsertMember: vi.fn(), removeMember: vi.fn(), fetchMembers: vi.fn(() => Promise.resolve()) })) },
}));
vi.mock("../stores/useReplyStore", () => ({
  useReplyStore: { getState: vi.fn(() => ({ clearReplyForDeletedMessage: vi.fn() })) },
}));
vi.mock("../stores/useChannelFilesStore", () => ({
  useChannelFilesStore: { getState: vi.fn(() => ({ filesOpen: false, fetchFiles: vi.fn(), fetchFile: vi.fn(), clearFileContent: vi.fn(), selectedFile: null })) },
}));
vi.mock("../stores/useThreadStore", () => ({
  useThreadStore: { getState: vi.fn(() => ({ setThreads: vi.fn(), addThread: vi.fn(), updateThread: vi.fn(), removeThread: vi.fn() })) },
}));
vi.mock("./api", () => ({
  ackMessage: vi.fn(() => Promise.resolve()),
  fetchGuildActiveThreads: vi.fn(() => Promise.resolve({ threads: [] })),
}));
vi.mock("./router", () => ({
  getActiveIdsFromRouter: vi.fn(() => ({ guildId: null, channelId: "c1", threadId: null })),
  getGuildForChannel: vi.fn(() => null),
  router: { navigate: vi.fn() },
}));
vi.mock("./routes", () => ({
  routes: {
    channel: vi.fn((g: string, c: string) => `/channels/${g}/${c}`),
    thread: vi.fn((g: string, c: string, t: string) => `/channels/${g}/${c}/threads/${t}`),
    root: vi.fn(() => "/"),
  },
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
