import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import type { Channel, Message, PermissionOverwrite } from "@cove/shared";
import { API_PREFIX, PermissionFlags } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";
import { GatewaySession } from "../ws/session.js";

describe("Permissions", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  const broadcastEvents: { t: string; d: unknown }[] = [];
  let adminToken: string;
  let defaultGuildId: string;
  let generalId: string;
  let dispatcher: GatewayDispatcher;

  class TestDispatcher extends GatewayDispatcher {
    constructor(repos: ReturnType<typeof createRepos>) {
      super(repos.channels, repos.guilds);
      this.setPermissionsRepo(repos.permissions);
    }
    override messageCreate(message: Message): void {
      broadcastEvents.push({ t: "MESSAGE_CREATE", d: message });
      super.messageCreate(message);
    }
  }

  beforeEach(() => {
    db = initDb(":memory:");
    defaultGuildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, defaultGuildId);
    generalId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;
    broadcastEvents.length = 0;
    process.env.RATE_LIMIT_ENABLED = "false";
    const repos = createRepos(db);
    dispatcher = new TestDispatcher(repos);
    app = createApp(db, repos, dispatcher);

    adminToken = "test-admin-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("admin", "Admin", null, 0, null, adminToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "admin", null, "[]", now);
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_ENABLED;
  });

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bot ${adminToken}`,
  });

  function createBotUser(id: string, username: string): string {
    const token = `bot-token-${id}`;
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, username, null, 1, null, token, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, id, null, "[]", now);
    return token;
  }

  // ─── CRUD ──────────────────────────────────────────────────────

  it("creates a permission overwrite and returns 204", async () => {
    createBotUser("bot1", "TestBot");
    const res = await app.request(`${API_PREFIX}/channels/${generalId}/permissions/bot1`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ type: 1, allow: PermissionFlags.VIEW_CHANNEL, deny: "0" }),
    });
    expect(res.status).toBe(204);
  });

  it("deletes a permission overwrite and returns 204", async () => {
    createBotUser("bot2", "TestBot2");

    await app.request(`${API_PREFIX}/channels/${generalId}/permissions/bot2`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ type: 1, allow: PermissionFlags.VIEW_CHANNEL, deny: "0" }),
    });

    const res = await app.request(`${API_PREFIX}/channels/${generalId}/permissions/bot2`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(204);
  });

  // ─── Channel GET includes permission_overwrites ────────────────

  it("channel GET includes permission_overwrites", async () => {
    createBotUser("bot3", "TestBot3");

    await app.request(`${API_PREFIX}/channels/${generalId}/permissions/bot3`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ type: 1, allow: PermissionFlags.VIEW_CHANNEL, deny: "0" }),
    });

    const res = await app.request(`${API_PREFIX}/channels/${generalId}`, {
      headers: { Authorization: `Bot ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const channel: Channel = await res.json();
    expect(channel.permission_overwrites).toHaveLength(1);
    const overwrite = channel.permission_overwrites[0] as PermissionOverwrite;
    expect(overwrite.id).toBe("bot3");
    expect(overwrite.type).toBe(1);
    expect(overwrite.allow).toBe(PermissionFlags.VIEW_CHANNEL);
    expect(overwrite.deny).toBe("0");
  });

  // ─── Channel list includes permission_overwrites ───────────────

  it("channel list includes permission_overwrites", async () => {
    createBotUser("bot4", "TestBot4");

    await app.request(`${API_PREFIX}/channels/${generalId}/permissions/bot4`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ type: 1, allow: PermissionFlags.VIEW_CHANNEL, deny: "0" }),
    });

    const res = await app.request(`${API_PREFIX}/guilds/${defaultGuildId}/channels`, {
      headers: { Authorization: `Bot ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const channels: Channel[] = await res.json();
    const general = channels.find((c) => c.id === generalId)!;
    expect(general.permission_overwrites).toHaveLength(1);
    expect(general.permission_overwrites[0].id).toBe("bot4");
  });

  // ─── Permission removed on channel delete (CASCADE) ────────────

  it("permissions are removed when channel is deleted", async () => {
    createBotUser("bot5", "TestBot5");

    const createRes = await app.request(`${API_PREFIX}/guilds/${defaultGuildId}/channels`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "temp-channel" }),
    });
    const tempChannel: Channel = await createRes.json();

    await app.request(`${API_PREFIX}/channels/${tempChannel.id}/permissions/bot5`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ type: 1, allow: PermissionFlags.VIEW_CHANNEL, deny: "0" }),
    });

    await app.request(`${API_PREFIX}/channels/${tempChannel.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    const row = db.prepare("SELECT * FROM channel_permission_overwrites WHERE channel_id = ?").get(tempChannel.id);
    expect(row).toBeUndefined();
  });

  // ─── Validation ────────────────────────────────────────────────

  it("rejects invalid type", async () => {
    const res = await app.request(`${API_PREFIX}/channels/${generalId}/permissions/bot1`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ type: 5, allow: "1024", deny: "0" }),
    });
    expect(res.status).toBe(400);
  });

  it("non-member gets 404", async () => {
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("outsider", "Outsider", null, 0, null, "outsider-token", now, now);

    const res = await app.request(`${API_PREFIX}/channels/${generalId}/permissions/someone`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer outsider-token",
      },
      body: JSON.stringify({ type: 1, allow: "1024", deny: "0" }),
    });
    expect(res.status).toBe(404);
  });

  // ─── Negative auth: bots cannot manage permissions ─────────────

  it("bot cannot PUT permissions (403)", async () => {
    const botToken = createBotUser("mgmt-bot", "MgmtBot");
    const res = await app.request(`${API_PREFIX}/channels/${generalId}/permissions/mgmt-bot`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify({ type: 1, allow: PermissionFlags.VIEW_CHANNEL, deny: "0" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(50013);
  });

  it("bot cannot DELETE permissions (403)", async () => {
    const botToken = createBotUser("del-bot", "DelBot");
    await app.request(`${API_PREFIX}/channels/${generalId}/permissions/del-bot`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ type: 1, allow: PermissionFlags.VIEW_CHANNEL, deny: "0" }),
    });

    const res = await app.request(`${API_PREFIX}/channels/${generalId}/permissions/del-bot`, {
      method: "DELETE",
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(50013);
  });

  // ─── Negative auth: denied bot cannot read/send messages ──────

  it("denied bot cannot read messages from channel (403)", async () => {
    const botToken = createBotUser("read-bot", "ReadBot");
    // No VIEW_CHANNEL permission granted
    const res = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
      method: "GET",
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(50013);
  });

  it("denied bot cannot send messages to channel (403)", async () => {
    const botToken = createBotUser("send-bot", "SendBot");
    // No VIEW_CHANNEL permission granted
    const res = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify({ content: "should fail" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(50013);
  });

  // ─── Dispatcher filtering ─────────────────────────────────────

  it("bot WITH VIEW_CHANNEL receives dispatched events", async () => {
    const botToken = createBotUser("filter-bot", "FilterBot");

    await app.request(`${API_PREFIX}/channels/${generalId}/permissions/filter-bot`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ type: 1, allow: PermissionFlags.VIEW_CHANNEL, deny: "0" }),
    });

    const dispatched: { event: string; data: unknown }[] = [];
    const mockWs = {
      readyState: 1, // WebSocket.OPEN
      send: (data: string) => {
        const parsed = JSON.parse(data);
        if (parsed.t) dispatched.push({ event: parsed.t, data: parsed.d });
      },
      close: () => {},
    } as any;

    const session = new GatewaySession(mockWs);
    session.user = { id: "filter-bot", username: "FilterBot", bot: true, avatar: null, discriminator: "0000", global_name: null };
    session.guildIds.add(defaultGuildId);
    (session as any).identified = true;
    dispatcher.addSession(session);

    const repos = createRepos(db);
    const msg: Message = {
      id: "msg-1",
      channel_id: generalId,
      content: "test",
      author: { id: "admin", username: "Admin", bot: false, avatar: null, discriminator: "0000", global_name: null },
      timestamp: new Date().toISOString(),
      type: 0,
      attachments: [],
      embeds: [],
      mentions: [],
      mention_roles: [],
      pinned: false,
      tts: false,
      mention_everyone: false,
    };
    dispatcher.messageCreate(msg);

    const msgEvents = dispatched.filter((e) => e.event === "MESSAGE_CREATE");
    expect(msgEvents.length).toBeGreaterThanOrEqual(1);

    dispatcher.removeSession(session);
  });

  it("bot WITHOUT VIEW_CHANNEL does NOT receive dispatched events", async () => {
    createBotUser("no-perm-bot", "NoPermBot");

    const dispatched: { event: string; data: unknown }[] = [];
    const mockWs = {
      readyState: 1,
      send: (data: string) => {
        const parsed = JSON.parse(data);
        if (parsed.t) dispatched.push({ event: parsed.t, data: parsed.d });
      },
      close: () => {},
    } as any;

    const session = new GatewaySession(mockWs);
    session.user = { id: "no-perm-bot", username: "NoPermBot", bot: true, avatar: null, discriminator: "0000", global_name: null };
    session.guildIds.add(defaultGuildId);
    (session as any).identified = true;
    dispatcher.addSession(session);

    const msg: Message = {
      id: "msg-2",
      channel_id: generalId,
      content: "test",
      author: { id: "admin", username: "Admin", bot: false, avatar: null, discriminator: "0000", global_name: null },
      timestamp: new Date().toISOString(),
      type: 0,
      attachments: [],
      embeds: [],
      mentions: [],
      mention_roles: [],
      pinned: false,
      tts: false,
      mention_everyone: false,
    };
    dispatcher.messageCreate(msg);

    const msgEvents = dispatched.filter((e) => e.event === "MESSAGE_CREATE");
    expect(msgEvents).toHaveLength(0);

    dispatcher.removeSession(session);
  });

  it("human user always receives messages regardless of permissions", async () => {
    const dispatched: { event: string; data: unknown }[] = [];
    const mockWs = {
      readyState: 1,
      send: (data: string) => {
        const parsed = JSON.parse(data);
        if (parsed.t) dispatched.push({ event: parsed.t, data: parsed.d });
      },
      close: () => {},
    } as any;

    const session = new GatewaySession(mockWs);
    session.user = { id: "admin", username: "Admin", bot: false, avatar: null, discriminator: "0000", global_name: null };
    session.guildIds.add(defaultGuildId);
    (session as any).identified = true;
    dispatcher.addSession(session);

    const msg: Message = {
      id: "msg-3",
      channel_id: generalId,
      content: "test",
      author: { id: "admin", username: "Admin", bot: false, avatar: null, discriminator: "0000", global_name: null },
      timestamp: new Date().toISOString(),
      type: 0,
      attachments: [],
      embeds: [],
      mentions: [],
      mention_roles: [],
      pinned: false,
      tts: false,
      mention_everyone: false,
    };
    dispatcher.messageCreate(msg);

    const msgEvents = dispatched.filter((e) => e.event === "MESSAGE_CREATE");
    expect(msgEvents.length).toBeGreaterThanOrEqual(1);

    dispatcher.removeSession(session);
  });
});
