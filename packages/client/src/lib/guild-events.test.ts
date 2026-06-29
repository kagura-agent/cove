import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatcher } from "./gateway-dispatcher";

// Mock all stores
const mockGuildStore = {
  guilds: {} as Record<string, any>,
  setGuilds: vi.fn(),
  addGuild: vi.fn(),
  updateGuild: vi.fn(),
  removeGuild: vi.fn(),
};
vi.mock("../stores/useGuildStore", () => ({
  useGuildStore: { getState: vi.fn(() => mockGuildStore) },
}));

const mockChannelStore = {
  addChannel: vi.fn(),
  updateChannel: vi.fn(),
  removeChannel: vi.fn(),
  setChannels: vi.fn(),
  removeGuildChannels: vi.fn(),
  getChannels: vi.fn(() => []),
  channelsByGuildId: {},
};
vi.mock("../stores/useChannelStore", () => ({
  useChannelStore: { getState: vi.fn(() => mockChannelStore) },
}));

const mockRoleStore = {
  setRoles: vi.fn(),
  addRole: vi.fn(),
  updateRole: vi.fn(),
  removeRole: vi.fn(),
};
vi.mock("../stores/useRoleStore", () => ({
  useRoleStore: { getState: vi.fn(() => mockRoleStore) },
}));

vi.mock("../stores/useMessageStore", () => ({
  useMessageStore: { getState: vi.fn(() => ({ addMessage: vi.fn(), updateMessage: vi.fn(), removeMessage: vi.fn(), removeChannelMessages: vi.fn(), setMessageThread: vi.fn() })) },
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
  useReadStateStore: { getState: vi.fn(() => ({ initReadStates: vi.fn(), setUnread: vi.fn(), setMentioned: vi.fn(), markRead: vi.fn(), removeChannel: vi.fn() })) },
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

const mockNavigate = vi.fn();
vi.mock("./router-helpers", () => ({
  getActiveIdsFromRouter: vi.fn(() => ({ guildId: "g1", channelId: "c1", threadId: null })),
  getGuildForChannel: vi.fn(() => "g1"),
}));
vi.mock("./router", () => {
  return {
    router: { navigate: (...args: any[]) => mockNavigate(...args) },
  };
});
vi.mock("./routes", () => ({
  routes: {
    channel: (gid: string, cid: string) => `/channels/${gid}/${cid}`,
    root: () => "/",
  },
}));
vi.mock("./prune-set.js", () => ({
  pruneSetIfNeeded: vi.fn(),
}));

import { setupGatewaySubscriptions, teardownGatewaySubscriptions } from "./gateway-subscriptions";

describe("Guild gateway events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGuildStore.guilds = {};
    teardownGatewaySubscriptions();
    setupGatewaySubscriptions();
  });

  it("GUILD_CREATE adds guild to sidebar", () => {
    dispatcher.emit("GUILD_CREATE", {
      id: "new-guild",
      name: "New Server",
      icon: null,
      owner_id: "user1",
      channels: [{ id: "ch1", name: "general", type: 0, guild_id: "new-guild", position: 0, topic: null, parent_id: null, last_message_id: null, permission_overwrites: [], nsfw: false, rate_limit_per_user: 0 }] as any,
      roles: [{ id: "new-guild", name: "@everyone", color: 0, hoist: false, position: 0, permissions: "0", managed: false, mentionable: false, flags: 0, bot_id: null }],
    });

    expect(mockGuildStore.addGuild).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new-guild", name: "New Server" })
    );
    expect(mockChannelStore.setChannels).toHaveBeenCalledWith("new-guild", expect.any(Array));
    expect(mockRoleStore.setRoles).toHaveBeenCalledWith("new-guild", expect.any(Array));
  });

  it("GUILD_UPDATE updates guild in store", () => {
    dispatcher.emit("GUILD_UPDATE", {
      id: "g1",
      name: "Renamed Server",
    });

    expect(mockGuildStore.updateGuild).toHaveBeenCalledWith("g1", expect.objectContaining({ name: "Renamed Server" }));
  });

  it("GUILD_DELETE removes guild and redirects if active", () => {
    // Simulate g1 being active (from mock router)
    mockGuildStore.guilds = { g2: { id: "g2", name: "Other" } };
    mockChannelStore.getChannels.mockReturnValue([{ id: "c2", name: "general", type: 0 }] as any);

    dispatcher.emit("GUILD_DELETE", { id: "g1" });

    expect(mockGuildStore.removeGuild).toHaveBeenCalledWith("g1");
    expect(mockChannelStore.removeGuildChannels).toHaveBeenCalledWith("g1");
    expect(mockNavigate).toHaveBeenCalledWith("/channels/g2/c2", { replace: true });
  });

  it("GUILD_DELETE navigates to root when no guilds left", () => {
    mockGuildStore.guilds = {};

    dispatcher.emit("GUILD_DELETE", { id: "g1" });

    expect(mockGuildStore.removeGuild).toHaveBeenCalledWith("g1");
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("GUILD_CREATE without channels/roles still adds guild", () => {
    dispatcher.emit("GUILD_CREATE", {
      id: "minimal-guild",
      name: "Minimal",
    });

    expect(mockGuildStore.addGuild).toHaveBeenCalledWith(
      expect.objectContaining({ id: "minimal-guild", name: "Minimal" })
    );
    expect(mockChannelStore.setChannels).not.toHaveBeenCalled();
    expect(mockRoleStore.setRoles).not.toHaveBeenCalled();
  });
});
