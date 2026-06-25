import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import type { Message } from "@cove/shared";
import { API_PREFIX, PermissionFlags } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";

describe("Mentions & Context Menu", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  const broadcastEvents: { t: string; d: unknown }[] = [];
  let adminToken: string;
  const adminId = "9000000000000000001";
  let defaultGuildId: string;
  let generalId: string;
  let botToken: string;
  let botId: string;

  class TestDispatcher extends GatewayDispatcher {
    constructor() { super({ getById: () => null } as any); }
    override messageCreate(message: Message): void {
      broadcastEvents.push({ t: "MESSAGE_CREATE", d: message });
    }
    override messageUpdate(message: Message): void {
      broadcastEvents.push({ t: "MESSAGE_UPDATE", d: message });
    }
    override messageDelete(channelId: string, messageId: string): void {
      broadcastEvents.push({ t: "MESSAGE_DELETE", d: { id: messageId, channel_id: channelId } });
    }
    override messageAck(_userId: string, _channelId: string, _messageId: string): void {
      broadcastEvents.push({ t: "MESSAGE_ACK", d: { user_id: _userId, channel_id: _channelId, message_id: _messageId } });
    }
  }

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken}`,
  });

  const botHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bot ${botToken}`,
  });

  beforeEach(async () => {
    db = initDb(":memory:");
    defaultGuildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, defaultGuildId);
    generalId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;
    broadcastEvents.length = 0;
    process.env.RATE_LIMIT_ENABLED = "false";
    app = createApp(db, createRepos(db), new TestDispatcher());

    // Admin user (human) — use snowflake-like numeric ID
    adminToken = "test-admin-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("9000000000000000001", "Admin", null, 0, null, adminToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "9000000000000000001", null, "[]", now);
    db.prepare("UPDATE guilds SET owner_id = ? WHERE id = ?").run("9000000000000000001", defaultGuildId);

    // Bot user
    const res = await app.request(`${API_PREFIX}/users`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ id: "9000000000000000002", username: "TestBot", bot: true }),
    });
    const bot = await res.json() as { id: string; token: string };
    botId = bot.id;
    botToken = bot.token;

    // Grant bot VIEW_CHANNEL
    await app.request(`${API_PREFIX}/channels/${generalId}/permissions/${botId}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ type: 1, allow: PermissionFlags.VIEW_CHANNEL, deny: "0" }),
    });
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_ENABLED;
  });

  // ─── Mention Resolution ─────────────────────────────────────────

  describe("mention resolution", () => {
    it("resolves <@userId> in message content to mentions array", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ content: "Hello <@9000000000000000001>!" }),
      });
      const msg = await res.json() as Message;
      expect(res.status).toBe(201);
      expect(msg.mentions).toHaveLength(1);
      expect(msg.mentions[0].id).toBe(adminId);
      expect(msg.mentions[0].username).toBe("Admin");
    });

    it("resolves mentions in MESSAGE_CREATE broadcast", async () => {
      await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ content: "Hey <@9000000000000000001> check this" }),
      });
      const createEvent = broadcastEvents.find((e) => e.t === "MESSAGE_CREATE");
      expect(createEvent).toBeDefined();
      const msg = createEvent!.d as Message;
      expect(msg.mentions).toHaveLength(1);
      expect(msg.mentions[0].id).toBe(adminId);
    });

    it("resolves mentions on message edit (MESSAGE_UPDATE)", async () => {
      // Create message without mention
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ content: "draft" }),
      });
      const msg = await res.json() as Message;
      expect(msg.mentions).toHaveLength(0);

      // Edit to add mention
      const editRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages/${msg.id}`, {
        method: "PATCH",
        headers: botHeaders(),
        body: JSON.stringify({ content: "draft <@9000000000000000001> done" }),
      });
      const edited = await editRes.json() as Message;
      expect(edited.mentions).toHaveLength(1);
      expect(edited.mentions[0].id).toBe(adminId);

      // Check broadcast
      const updateEvent = broadcastEvents.find((e) => e.t === "MESSAGE_UPDATE");
      expect(updateEvent).toBeDefined();
      const broadcastMsg = updateEvent!.d as Message;
      expect(broadcastMsg.mentions).toHaveLength(1);
    });

    it("does not resolve mentions for non-guild-members", async () => {
      // Create a user NOT in the guild
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("9000000000000000003", "Outsider", null, 0, null, "outsider-token", Date.now(), Date.now());

      const res = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ content: "Hello <@9000000000000000003>!" }),
      });
      const msg = await res.json() as Message;
      expect(msg.mentions).toHaveLength(0);
    });

    it("resolves multiple mentions in one message", async () => {
      // Create second guild member
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("9000000000000000004", "Alice", null, 0, null, "user2-token", Date.now(), Date.now());
      db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
        .run(defaultGuildId, "9000000000000000004", null, "[]", Date.now());

      const res = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ content: "Hey <@9000000000000000001> and <@9000000000000000004>!" }),
      });
      const msg = await res.json() as Message;
      expect(msg.mentions).toHaveLength(2);
      const ids = msg.mentions.map((m) => m.id).sort();
      expect(ids).toEqual([adminId, "9000000000000000004"]);
    });
  });

  // ─── Mention Count ──────────────────────────────────────────────

  describe("mention_count", () => {
    it("increments mention_count when a user is mentioned", async () => {
      await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ content: "Hey <@9000000000000000001>!" }),
      });

      const repos = createRepos(db);
      const readState = repos.readStates.get(adminId, generalId);
      expect(readState).toBeDefined();
      expect(readState!.mention_count).toBe(1);
    });

    it("increments mention_count on edit when new mention appears", async () => {
      // Create without mention
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ content: "draft" }),
      });
      const msg = await res.json() as Message;

      // Edit to add mention
      await app.request(`${API_PREFIX}/channels/${generalId}/messages/${msg.id}`, {
        method: "PATCH",
        headers: botHeaders(),
        body: JSON.stringify({ content: "draft <@9000000000000000001>" }),
      });

      const repos = createRepos(db);
      const readState = repos.readStates.get(adminId, generalId);
      expect(readState).toBeDefined();
      expect(readState!.mention_count).toBe(1);
    });

    it("does not double-count mention on edit when mention was already present", async () => {
      // Create with mention
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ content: "Hey <@9000000000000000001>!" }),
      });
      const msg = await res.json() as Message;

      // Edit but keep same mention
      await app.request(`${API_PREFIX}/channels/${generalId}/messages/${msg.id}`, {
        method: "PATCH",
        headers: botHeaders(),
        body: JSON.stringify({ content: "Hey <@9000000000000000001>! updated" }),
      });

      const repos = createRepos(db);
      const readState = repos.readStates.get(adminId, generalId);
      expect(readState!.mention_count).toBe(1);
    });

    it("does not increment mention_count for message sender", async () => {
      // Bot mentions itself
      await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ content: `Hey <@${botId}>!` }),
      });

      const repos = createRepos(db);
      const readState = repos.readStates.get(botId, generalId);
      // Should be 0 or undefined — sender shouldn't get mention count
      expect(readState?.mention_count ?? 0).toBe(0);
    });

    it("resets mention_count on ack", async () => {
      // Send message mentioning admin
      await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ content: "Hey <@9000000000000000001>!" }),
      });

      // Admin acks the channel
      const msgs = await (await app.request(`${API_PREFIX}/channels/${generalId}/messages?limit=1`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })).json() as Message[];

      await app.request(`${API_PREFIX}/channels/${generalId}/messages/${msgs[0].id}/ack`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({}),
      });

      const repos = createRepos(db);
      const readState = repos.readStates.get(adminId, generalId);
      expect(readState!.mention_count).toBe(0);
    });
  });

  // ─── Webhook Mention Resolution ─────────────────────────────────

  describe("webhook mention resolution", () => {
    it("resolves mentions in webhook messages", async () => {
      // Create a webhook
      const whRes = await app.request(`${API_PREFIX}/channels/${generalId}/webhooks`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: "Test Hook" }),
      });
      const webhook = await whRes.json() as { id: string; token: string };

      // Execute webhook with mention
      const execRes = await app.request(`${API_PREFIX}/webhooks/${webhook.id}/${webhook.token}?wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Hello <@9000000000000000001>!" }),
      });
      const msg = await execRes.json() as Message;
      expect(msg.mentions).toHaveLength(1);
      expect(msg.mentions[0].id).toBe(adminId);
    });
  });

  // ─── Delete Message ─────────────────────────────────────────────

  describe("delete message", () => {
    it("allows author to delete own message", async () => {
      // Bot sends a message
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ content: "delete me" }),
      });
      const msg = await res.json() as Message;

      // Bot deletes it
      const delRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages/${msg.id}`, {
        method: "DELETE",
        headers: botHeaders(),
      });
      expect(delRes.status).toBe(204);

      // Verify MESSAGE_DELETE broadcast
      const deleteEvent = broadcastEvents.find((e) => e.t === "MESSAGE_DELETE");
      expect(deleteEvent).toBeDefined();
      expect((deleteEvent!.d as { id: string }).id).toBe(msg.id);

      // Verify message is gone
      const getRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages?limit=50`, {
        headers: botHeaders(),
      });
      const msgs = await getRes.json() as Message[];
      expect(msgs.find((m) => m.id === msg.id)).toBeUndefined();
    });

    it("returns 404 for non-existent message", async () => {
      const delRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages/999999`, {
        method: "DELETE",
        headers: botHeaders(),
      });
      expect(delRes.status).toBe(404);
    });
  });

  // ─── Read State with mention_count ──────────────────────────────

  describe("read state includes mention_count", () => {
    it("getAllForUserWithLastMessage returns mention_count", async () => {
      // Send message mentioning admin
      await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ content: "Hey <@9000000000000000001>!" }),
      });

      const repos = createRepos(db);
      const states = repos.readStates.getAllForUserWithLastMessage(adminId);
      const generalState = states.find((s) => s.channel_id === generalId);
      expect(generalState).toBeDefined();
      expect(generalState!.mention_count).toBe(1);
    });
  });
});
