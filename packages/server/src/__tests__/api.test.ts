import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import type { Channel, Message, CoveAgent, CoveGuildMember } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";

describe("Cove API — Discord-compatible", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  const broadcastEvents: { t: string; d: unknown }[] = [];
  let adminToken: string;
  let defaultGuildId: string;

  class TestDispatcher extends GatewayDispatcher {
    override messageCreate(message: Message): void {
      broadcastEvents.push({ t: "MESSAGE_CREATE", d: message });
    }
    override messageUpdate(message: Message): void {
      broadcastEvents.push({ t: "MESSAGE_UPDATE", d: message });
    }
    override messageDelete(channelId: string, messageId: string): void {
      broadcastEvents.push({ t: "MESSAGE_DELETE", d: { id: messageId, channel_id: channelId } });
    }
    override channelUpdate(channel: Channel): void {
      broadcastEvents.push({ t: "CHANNEL_UPDATE", d: channel });
    }
    override typingStart(channelId: string, user: { id: string; username: string }): void {
      broadcastEvents.push({ t: "TYPING_START", d: { channel_id: channelId, user_id: user.id, username: user.username, timestamp: Date.now() } });
    }
  }

  beforeEach(() => {
    db = initDb(":memory:");
    defaultGuildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, defaultGuildId);
    broadcastEvents.length = 0;
    app = createApp(db, createRepos(db), new TestDispatcher());

    // Bootstrap an admin bot directly in DB for auth
    adminToken = "test-admin-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("admin", "Admin", null, 1, null, adminToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "admin", null, "[]", now);
  });

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bot ${adminToken}`,
  });

  const authGet = (path: string) => app.request(path, { headers: { Authorization: `Bot ${adminToken}` } });

  // Helper to create a bot user and get its token
  async function createBotUser(id: string, username: string, extra?: Record<string, unknown>) {
    const res = await app.request("/api/v10/users", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ id, username, ...extra }),
    });
    return res.json() as Promise<CoveAgent & { token: string }>;
  }

  // ─── Channels ───────────────────────────────────────────────────────────

  describe("GET /api/v10/guilds/:guildId/channels", () => {
    it("returns all seeded channels in Discord format", async () => {
      const res = await authGet(`/api/v10/guilds/${defaultGuildId}/channels`);
      expect(res.status).toBe(200);
      const channels: Channel[] = await res.json();
      expect(channels).toHaveLength(2);
    });

    it("each channel has Discord-required fields", async () => {
      const res = await authGet(`/api/v10/guilds/${defaultGuildId}/channels`);
      const channels: Channel[] = await res.json();
      for (const ch of channels) {
        expect(ch.id).toBeTruthy();
        expect(ch.name).toBeTruthy();
        expect(ch.type).toBe(0);
        expect(ch.guild_id).toBe(defaultGuildId);
        expect(typeof ch.position).toBe("number");
      }
    });

    it("channels are ordered by position", async () => {
      const res = await authGet(`/api/v10/guilds/${defaultGuildId}/channels`);
      const channels: Channel[] = await res.json();
      expect(channels[0].name).toBe("general");
      expect(channels[0].position).toBe(0);
      expect(channels[1].name).toBe("random");
      expect(channels[1].position).toBe(1);
    });

    it("returns 404 for unknown guild", async () => {
      const res = await authGet("/api/v10/guilds/unknown/channels");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v10/channels/:id", () => {
    it("returns a specific channel in Discord format", async () => {
      const res = await authGet("/api/v10/channels/general");
      expect(res.status).toBe(200);
      const ch: Channel = await res.json();
      expect(ch.id).toBe("general");
      expect(ch.name).toBe("general");
      expect(ch.type).toBe(0);
      expect(ch.guild_id).toBe(defaultGuildId);
      expect(ch.topic).toBe("General discussion");
    });

    it("returns 404 for unknown channel", async () => {
      const res = await authGet("/api/v10/channels/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  // ─── Messages ───────────────────────────────────────────────────────────

  describe("GET /api/v10/channels/:id/messages", () => {
    it("returns empty array for channel with no messages", async () => {
      const res = await authGet("/api/v10/channels/general/messages");
      expect(res.status).toBe(200);
      const messages: Message[] = await res.json();
      expect(messages).toEqual([]);
    });

    it("returns 404 for unknown channel", async () => {
      const res = await authGet("/api/v10/channels/nonexistent/messages");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/v10/channels/:id/messages", () => {
    it("creates a message and returns Discord format", async () => {
      const bot = await createBotUser("kagura", "Kagura");
      const res = await app.request("/api/v10/channels/general/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${bot.token}`,
        },
        body: JSON.stringify({ content: "Hello world!" }),
      });
      expect(res.status).toBe(201);
      const msg: Message = await res.json();
      expect(msg.channel_id).toBe("general");
      expect(msg.content).toBe("Hello world!");
      expect(msg.author.id).toBe("kagura");
      expect(msg.author.username).toBe("Kagura");
      expect(msg.author.bot).toBe(true);
      expect(msg.type).toBe(0);
      expect(msg.id).toBeTruthy();
      expect(msg.timestamp).toBeTruthy();
      expect(new Date(msg.timestamp).toISOString()).toBe(msg.timestamp);
    });

    it("returns 401 when no auth header", async () => {
      const res = await app.request("/api/v10/channels/general/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Hello" }),
      });
      expect(res.status).toBe(401);
    });

    it("message appears in channel messages list", async () => {
      const bot = await createBotUser("kagura", "Kagura");
      await app.request("/api/v10/channels/general/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${bot.token}`,
        },
        body: JSON.stringify({ content: "Test message" }),
      });

      const res = await authGet("/api/v10/channels/general/messages");
      const messages: Message[] = await res.json();
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Test message");
      expect(messages[0].channel_id).toBe("general");
    });

    it("broadcasts MESSAGE_CREATE event", async () => {
      const bot = await createBotUser("kagura", "Kagura");
      await app.request("/api/v10/channels/general/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${bot.token}`,
        },
        body: JSON.stringify({ content: "test broadcast" }),
      });

      expect(broadcastEvents).toHaveLength(1);
      const event = broadcastEvents[0] as { t: string; d: Message };
      expect(event.t).toBe("MESSAGE_CREATE");
      expect(event.d.content).toBe("test broadcast");
    });

    it("returns 404 for unknown channel", async () => {
      const res = await app.request("/api/v10/channels/nonexistent/messages", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "hello" }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Single message ─────────────────────────────────────────────────────

  describe("GET /api/v10/channels/:id/messages/:msgId", () => {
    it("returns a single message by ID", async () => {
      const bot = await createBotUser("kagura", "Kagura");
      const createRes = await app.request("/api/v10/channels/general/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bot ${bot.token}` },
        body: JSON.stringify({ content: "find me" }),
      });
      const created: Message = await createRes.json();

      const res = await authGet(`/api/v10/channels/general/messages/${created.id}`);
      expect(res.status).toBe(200);
      const msg: Message = await res.json();
      expect(msg.id).toBe(created.id);
      expect(msg.content).toBe("find me");
      expect(msg.channel_id).toBe("general");
    });

    it("returns 404 for nonexistent message", async () => {
      const res = await authGet("/api/v10/channels/general/messages/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  // ─── Delete single message ──────────────────────────────────────────────

  describe("DELETE /api/v10/channels/:id/messages/:msgId", () => {
    it("deletes a message and returns 204", async () => {
      const bot = await createBotUser("kagura", "Kagura");
      const createRes = await app.request("/api/v10/channels/general/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bot ${bot.token}` },
        body: JSON.stringify({ content: "delete me" }),
      });
      const created: Message = await createRes.json();
      broadcastEvents.length = 0;

      const delRes = await app.request(`/api/v10/channels/general/messages/${created.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bot ${adminToken}` },
      });
      expect(delRes.status).toBe(204);

      // Verify MESSAGE_DELETE broadcast
      expect(broadcastEvents).toHaveLength(1);
      const event = broadcastEvents[0] as { t: string; d: { id: string; channel_id: string } };
      expect(event.t).toBe("MESSAGE_DELETE");
      expect(event.d.id).toBe(created.id);
      expect(event.d.channel_id).toBe("general");

      // Verify message is gone
      const getRes = await authGet(`/api/v10/channels/general/messages/${created.id}`);
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for nonexistent message", async () => {
      const res = await app.request("/api/v10/channels/general/messages/nonexistent", {
        method: "DELETE",
        headers: { Authorization: `Bot ${adminToken}` },
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Edit message ───────────────────────────────────────────────────────

  describe("PATCH /api/v10/channels/:id/messages/:msgId", () => {
    it("edits a message and returns updated content with edited_timestamp", async () => {
      const bot = await createBotUser("kagura", "Kagura");
      const createRes = await app.request("/api/v10/channels/general/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bot ${bot.token}` },
        body: JSON.stringify({ content: "original" }),
      });
      const created: Message = await createRes.json();
      expect(created.edited_timestamp).toBeNull();
      broadcastEvents.length = 0;

      const patchRes = await app.request(`/api/v10/channels/general/messages/${created.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ content: "edited" }),
      });
      expect(patchRes.status).toBe(200);
      const updated: Message = await patchRes.json();
      expect(updated.content).toBe("edited");
      expect(updated.edited_timestamp).toBeTruthy();
      expect(new Date(updated.edited_timestamp!).toISOString()).toBe(updated.edited_timestamp);

      // Verify MESSAGE_UPDATE broadcast
      expect(broadcastEvents).toHaveLength(1);
      const event = broadcastEvents[0] as { t: string; d: Message };
      expect(event.t).toBe("MESSAGE_UPDATE");
      expect(event.d.content).toBe("edited");
    });

    it("returns 404 for nonexistent message", async () => {
      const res = await app.request("/api/v10/channels/general/messages/nonexistent", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ content: "nope" }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Typing indicator ──────────────────────────────────────────────────

  describe("POST /api/v10/channels/:id/typing", () => {
    it("returns 204 and broadcasts TYPING_START", async () => {
      const bot = await createBotUser("kagura", "Kagura");
      broadcastEvents.length = 0;
      const res = await app.request("/api/v10/channels/general/typing", {
        method: "POST",
        headers: { Authorization: `Bot ${bot.token}` },
      });
      expect(res.status).toBe(204);

      expect(broadcastEvents).toHaveLength(1);
      const event = broadcastEvents[0] as { t: string; d: { channel_id: string; user_id: string; timestamp: number } };
      expect(event.t).toBe("TYPING_START");
      expect(event.d.channel_id).toBe("general");
      expect(event.d.user_id).toBe("kagura");
      expect(typeof event.d.timestamp).toBe("number");
    });
  });

  // ─── Pagination ────────────────────────────────────────────────────────

  describe("GET /api/v10/channels/:id/messages — pagination", () => {
    let messageIds: string[];

    beforeEach(() => {
      // Insert 5 messages with incrementing timestamps
      messageIds = [];
      const insert = db.prepare(
        "INSERT INTO messages (id, channel_id, sender, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      for (let i = 0; i < 5; i++) {
        const id = `msg-${i}`;
        insert.run(id, "general", "kagura", `message ${i}`, 1000000 + i * 1000, null, null);
        messageIds.push(id);
      }
    });

    it("before returns messages older than reference", async () => {
      const res = await authGet("/api/v10/channels/general/messages?before=msg-3");
      expect(res.status).toBe(200);
      const msgs: Message[] = await res.json();
      expect(msgs).toHaveLength(3);
      // DESC order
      expect(msgs[0].id).toBe("msg-2");
      expect(msgs[1].id).toBe("msg-1");
      expect(msgs[2].id).toBe("msg-0");
    });

    it("after returns messages newer than reference", async () => {
      const res = await authGet("/api/v10/channels/general/messages?after=msg-1");
      expect(res.status).toBe(200);
      const msgs: Message[] = await res.json();
      expect(msgs).toHaveLength(3);
      // ASC order for after
      expect(msgs[0].id).toBe("msg-2");
      expect(msgs[1].id).toBe("msg-3");
      expect(msgs[2].id).toBe("msg-4");
    });

    it("around returns messages around reference", async () => {
      const res = await authGet("/api/v10/channels/general/messages?around=msg-2&limit=4");
      expect(res.status).toBe(200);
      const msgs: Message[] = await res.json();
      expect(msgs.length).toBeGreaterThanOrEqual(3);
      const ids = msgs.map((m) => m.id);
      expect(ids).toContain("msg-2");
    });

    it("returns empty array for unknown reference message", async () => {
      const res = await authGet("/api/v10/channels/general/messages?before=nonexistent");
      expect(res.status).toBe(200);
      const msgs: Message[] = await res.json();
      expect(msgs).toEqual([]);
    });
  });

  // ─── Channel PATCH ──────────────────────────────────────────────────

  describe("PATCH /api/v10/channels/:id", () => {
    it("updates channel name and topic", async () => {
      const res = await app.request("/api/v10/channels/general", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: "announcements", topic: "Important updates" }),
      });
      expect(res.status).toBe(200);
      const ch: Channel = await res.json();
      expect(ch.name).toBe("announcements");
      expect(ch.topic).toBe("Important updates");
      expect(ch.id).toBe("general");
    });

    it("updates position", async () => {
      const res = await app.request("/api/v10/channels/general", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ position: 5 }),
      });
      expect(res.status).toBe(200);
      const ch: Channel = await res.json();
      expect(ch.position).toBe(5);
    });

    it("updates type", async () => {
      const res = await app.request("/api/v10/channels/general", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ type: 2 }),
      });
      expect(res.status).toBe(200);
      const ch: Channel = await res.json();
      expect(ch.type).toBe(2);
    });

    it("broadcasts CHANNEL_UPDATE event", async () => {
      broadcastEvents.length = 0;
      await app.request("/api/v10/channels/general", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ topic: "updated" }),
      });

      expect(broadcastEvents).toHaveLength(1);
      const event = broadcastEvents[0] as { t: string; d: Channel };
      expect(event.t).toBe("CHANNEL_UPDATE");
      expect(event.d.topic).toBe("updated");
    });

    it("returns current state for empty body", async () => {
      const res = await app.request("/api/v10/channels/general", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const ch: Channel = await res.json();
      expect(ch.id).toBe("general");
    });

    it("returns 404 for unknown channel", async () => {
      const res = await app.request("/api/v10/channels/nonexistent", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: "nope" }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Channel CREATE ─────────────────────────────────────────────────

  describe("POST /api/v10/guilds/:guildId/channels", () => {
    it("creates a channel with auto-incremented position", async () => {
      const res = await app.request(`/api/v10/guilds/${defaultGuildId}/channels`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: "new-channel", topic: "A new channel" }),
      });
      expect(res.status).toBe(201);
      const ch: Channel = await res.json();
      expect(ch.name).toBe("new-channel");
      expect(ch.topic).toBe("A new channel");
      expect(ch.type).toBe(0);
      expect(ch.position).toBe(2); // after general(0) and random(1)
    });
  });

  // ─── Channel DELETE ─────────────────────────────────────────────────

  describe("DELETE /api/v10/channels/:id", () => {
    it("deletes a channel", async () => {
      const res = await app.request("/api/v10/channels/random", {
        method: "DELETE",
        headers: { Authorization: `Bot ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleted).toBe(true);

      // Verify it's gone
      const getRes = await authGet("/api/v10/channels/random");
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for unknown channel", async () => {
      const res = await app.request("/api/v10/channels/nonexistent", {
        method: "DELETE",
        headers: { Authorization: `Bot ${adminToken}` },
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Users (Bot Users) ───────────────────────────────────────────────

  describe("User CRUD (Discord-compatible)", () => {
    it("POST /users creates a bot user and returns token", async () => {
      const res = await app.request("/api/v10/users", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          id: "kagura",
          username: "Kagura",
          avatar: "🌸",
          bio: "AI assistant",
        }),
      });
      expect(res.status).toBe(201);
      const user = await res.json();
      expect(user.id).toBe("kagura");
      expect(user.username).toBe("Kagura");
      expect(user.avatar).toBe("🌸");
      expect(user.bot).toBe(true);
      expect(user.token).toBeTruthy();
      expect(typeof user.token).toBe("string");
    });

    it("POST auto-generates ID from username", async () => {
      const res = await app.request("/api/v10/users", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ username: "Test Bot" }),
      });
      expect(res.status).toBe(201);
      const user: CoveAgent = await res.json();
      expect(user.id).toBe("test-bot");
    });

    it("POST returns 409 for duplicate ID", async () => {
      await app.request("/api/v10/users", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ id: "dup", username: "First" }),
      });
      const res = await app.request("/api/v10/users", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ id: "dup", username: "Second" }),
      });
      expect(res.status).toBe(409);
    });

    it("POST returns 401 without auth", async () => {
      const res = await app.request("/api/v10/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "noauth", username: "NoAuth" }),
      });
      expect(res.status).toBe(401);
    });

    it("GET /users/:id returns a user", async () => {
      await createBotUser("solo", "Solo");

      const res = await authGet("/api/v10/users/solo");
      expect(res.status).toBe(200);
      const user: CoveAgent = await res.json();
      expect(user.id).toBe("solo");
      expect(user.bot).toBe(true);
    });

    it("GET /users/:id returns 404 for unknown", async () => {
      const res = await authGet("/api/v10/users/nonexistent");
      expect(res.status).toBe(404);
    });

    it("PATCH updates user fields", async () => {
      await createBotUser("patchme", "Original");

      const res = await app.request("/api/v10/users/patchme", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ username: "Updated", bio: "New bio" }),
      });
      expect(res.status).toBe(200);
      const user: CoveAgent = await res.json();
      expect(user.username).toBe("Updated");
      expect(user.bio).toBe("New bio");
    });

    it("DELETE removes a user", async () => {
      await createBotUser("deleteme", "Delete");

      const res = await app.request("/api/v10/users/deleteme", {
        method: "DELETE",
        headers: { Authorization: `Bot ${adminToken}` },
      });
      expect(res.status).toBe(204);

      const getRes = await authGet("/api/v10/users/deleteme");
      expect(getRes.status).toBe(404);
    });

    it("DELETE returns 401 without auth", async () => {
      await createBotUser("protecteduser", "Protected");
      const res = await app.request("/api/v10/users/protecteduser", { method: "DELETE" });
      expect(res.status).toBe(401);
    });
  });

  // ─── Guild Members (Discord-compatible) ─────────────────────────────

  describe("Guild Members (Discord-compatible)", () => {
    beforeEach(async () => {
      await app.request("/api/v10/users", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ id: "bot-a", username: "Bot A" }),
      });
      await app.request("/api/v10/users", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ id: "bot-b", username: "Bot B" }),
      });
    });

    it("PUT returns existing member for auto-joined bot", async () => {
      const res = await app.request(`/api/v10/guilds/${defaultGuildId}/members/bot-a`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const member: CoveGuildMember = await res.json();
      expect(member.user.id).toBe("bot-a");
      expect(member.user.username).toBe("Bot A");
      expect(member.roles).toEqual([]);
      expect(member.joined_at).toBeTruthy();
    });

    it("PUT with nick and roles on auto-joined member", async () => {
      const res = await app.request(`/api/v10/guilds/${defaultGuildId}/members/bot-a`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ nick: "Gardener Bot", roles: ["gardener"] }),
      });
      expect(res.status).toBe(200);
      const member: CoveGuildMember = await res.json();
      expect(member.user.id).toBe("bot-a");
    });

    it("PUT returns existing member for duplicate", async () => {
      await app.request(`/api/v10/guilds/${defaultGuildId}/members/bot-a`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const res = await app.request(`/api/v10/guilds/${defaultGuildId}/members/bot-a`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    });

    it("GET lists guild members (auto-joined on creation)", async () => {
      const res = await authGet(`/api/v10/guilds/${defaultGuildId}/members`);
      expect(res.status).toBe(200);
      const members: CoveGuildMember[] = await res.json();
      expect(members).toHaveLength(3);
    });

    it("GET returns 404 for unknown guild", async () => {
      const res = await authGet("/api/v10/guilds/unknown/members");
      expect(res.status).toBe(404);
    });

    it("DELETE removes member from guild", async () => {
      const res = await app.request(`/api/v10/guilds/${defaultGuildId}/members/bot-a`, { method: "DELETE", headers: { Authorization: `Bot ${adminToken}` } });
      expect(res.status).toBe(204);

      const listRes = await authGet(`/api/v10/guilds/${defaultGuildId}/members`);
      const members: CoveGuildMember[] = await listRes.json();
      expect(members).toHaveLength(2);
      expect(members.find((m) => m.user.id === "bot-a")).toBeUndefined();
    });

    it("deleting user cascades to guild membership", async () => {
      await app.request("/api/v10/users/bot-a", {
        method: "DELETE",
        headers: { Authorization: `Bot ${adminToken}` },
      });

      const listRes = await authGet(`/api/v10/guilds/${defaultGuildId}/members`);
      const members: CoveGuildMember[] = await listRes.json();
      expect(members).toHaveLength(2);
      expect(members.find((m) => m.user.id === "bot-a")).toBeUndefined();
    });
  });

  // ─── Non-member guild access ──────────────────────────────────────────

  describe("Non-member guild access", () => {
    let outsiderToken: string;

    beforeEach(() => {
      const now = Date.now();
      outsiderToken = "outsider-token";
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("outsider", "Outsider", null, 1, null, outsiderToken, now, now);
    });

    it("non-member GET /guilds/cove/channels returns 404", async () => {
      const res = await app.request(`/api/v10/guilds/${defaultGuildId}/channels`, {
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("non-member GET /guilds/cove/members returns 404", async () => {
      const res = await app.request(`/api/v10/guilds/${defaultGuildId}/members`, {
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot access direct channel route", async () => {
      const res = await app.request("/api/v10/channels/general", {
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot read channel messages", async () => {
      const res = await app.request("/api/v10/channels/general/messages", {
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot post message to channel", async () => {
      const res = await app.request("/api/v10/channels/general/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bot ${outsiderToken}` },
        body: JSON.stringify({ content: "sneaky message" }),
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot update channel", async () => {
      const res = await app.request("/api/v10/channels/general", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bot ${outsiderToken}` },
        body: JSON.stringify({ name: "hacked" }),
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot delete channel", async () => {
      const res = await app.request("/api/v10/channels/general", {
        method: "DELETE",
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot trigger typing", async () => {
      const res = await app.request("/api/v10/channels/general/typing", {
        method: "POST",
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot add guild member", async () => {
      const res = await app.request(`/api/v10/guilds/${defaultGuildId}/members/someuser`, {
        method: "PUT",
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot remove guild member", async () => {
      const res = await app.request(`/api/v10/guilds/${defaultGuildId}/members/someuser`, {
        method: "DELETE",
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot get single message", async () => {
      const res = await app.request("/api/v10/channels/general/messages/msg123", {
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot edit message", async () => {
      const res = await app.request("/api/v10/channels/general/messages/msg123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bot ${outsiderToken}` },
        body: JSON.stringify({ content: "hacked" }),
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot delete message", async () => {
      const res = await app.request("/api/v10/channels/general/messages/msg123", {
        method: "DELETE",
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Gateway discovery ────────────────────────────────────────────────

  describe("GET /api/v10/gateway", () => {
    it("returns WebSocket URL", async () => {
      const res = await authGet("/api/v10/gateway");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.url).toBe("ws://localhost:3000/gateway");
    });
  });

  // ─── Guilds ───────────────────────────────────────────────────────────

  describe("GET /api/v10/users/@me/guilds", () => {
    it("returns guilds for authenticated user", async () => {
      const res = await authGet("/api/v10/users/@me/guilds");
      expect(res.status).toBe(200);
      const guilds = await res.json();
      expect(guilds).toHaveLength(1);
      expect(guilds[0].id).toBe(defaultGuildId);
      expect(guilds[0].name).toBe("Cove");
      expect(guilds[0]).toHaveProperty("icon");
      expect(guilds[0]).toHaveProperty("owner_id");
    });

    it("returns 401 when no auth", async () => {
      const res = await app.request("/api/v10/users/@me/guilds");
      expect(res.status).toBe(401);
    });
  });

  // ─── Users ────────────────────────────────────────────────────────────

  describe("GET /api/v10/users/@me", () => {
    it("returns bot user info from auth header (token-based)", async () => {
      const bot = await createBotUser("kagura", "Kagura");
      const res = await app.request("/api/v10/users/@me", {
        headers: { Authorization: `Bot ${bot.token}` },
      });
      expect(res.status).toBe(200);
      const user = await res.json();
      expect(user.id).toBe("kagura");
      expect(user.username).toBe("Kagura");
      expect(user.bot).toBe(true);
    });

    it("returns 401 when no auth", async () => {
      const res = await app.request("/api/v10/users/@me");
      expect(res.status).toBe(401);
    });

    it("returns 401 for invalid token", async () => {
      const res = await app.request("/api/v10/users/@me", {
        headers: { Authorization: "Bot invalid-token-123" },
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── Invite Code Registration ───────────────────────────────────────

  describe("Invite Code Registration", () => {
    function seedInviteCode(code: string) {
      db.prepare("INSERT INTO invite_codes (id, code, created_at) VALUES (?, ?, ?)")
        .run(`inv-${code}`, code, Date.now());
    }

    function seedPending(id: string, token: string, email: string, username: string) {
      db.prepare(
        "INSERT INTO pending_registrations (id, pending_token, google_id, email, username, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(id, token, `google-${id}`, email, username, null, Date.now());
    }

    it("POST /api/v10/auth/register with valid invite code creates user", async () => {
      seedInviteCode("COVE-TEST-AA01");
      seedPending("p1", "tok-1", "newuser@example.com", "New User");

      const res = await app.request("/api/v10/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "COVE-TEST-AA01", pendingToken: "tok-1" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { token: string };
      expect(data.token).toBeTruthy();

      const userRow = db.prepare("SELECT id, username FROM users WHERE token = ?").get(data.token) as { id: string; username: string } | undefined;
      expect(userRow).toBeDefined();
      expect(userRow!.username).toBe("New User");
      expect(userRow!.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("normalizes invite code input (lowercase + whitespace)", async () => {
      seedInviteCode("COVE-NORM-BB02");
      seedPending("p-norm", "tok-norm", "norm@example.com", "NormUser");

      const res = await app.request("/api/v10/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "  cove-norm-bb02  ", pendingToken: "tok-norm" }),
      });
      expect(res.status).toBe(200);
    });

    it("returns 400 for invalid code", async () => {
      seedPending("p2", "tok-2", "test@example.com", "Test");

      const res = await app.request("/api/v10/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "COVE-FAKE-CODE", pendingToken: "tok-2" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for already-used code", async () => {
      seedInviteCode("COVE-USED-CC03");
      seedPending("p3", "tok-3", "user1@example.com", "User1");

      await app.request("/api/v10/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "COVE-USED-CC03", pendingToken: "tok-3" }),
      });

      seedPending("p4", "tok-4", "user2@example.com", "User2");
      const res = await app.request("/api/v10/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "COVE-USED-CC03", pendingToken: "tok-4" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid pending token", async () => {
      seedInviteCode("COVE-PEND-DD04");

      const res = await app.request("/api/v10/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "COVE-PEND-DD04", pendingToken: "nonexistent" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when missing fields", async () => {
      const res = await app.request("/api/v10/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "COVE-XXXX-YYYY" }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Health ───────────────────────────────────────────────────────────

  describe("GET /api/health", () => {
    it("returns ok", async () => {
      const res = await authGet("/api/health");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ status: "ok" });
    });

    it("is accessible without authentication", async () => {
      const res = await app.request("/api/health");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ status: "ok" });
    });
  });

  // ─── Request body validation ───────────────────────────────────────────

  describe("Request body validation", () => {
    it("POST message rejects missing content", async () => {
      const res = await app.request("/api/v10/channels/general/messages", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("POST message rejects content over 4000 chars", async () => {
      const res = await app.request("/api/v10/channels/general/messages", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "x".repeat(4001) }),
      });
      expect(res.status).toBe(400);
    });

    it("POST message rejects invalid JSON", async () => {
      const res = await app.request("/api/v10/channels/general/messages", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    it("PATCH message rejects empty content", async () => {
      const bot = await createBotUser("val-bot", "ValBot");
      const createRes = await app.request("/api/v10/channels/general/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bot ${bot.token}` },
        body: JSON.stringify({ content: "original" }),
      });
      const msg: Message = await createRes.json();

      const res = await app.request(`/api/v10/channels/general/messages/${msg.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ content: "" }),
      });
      expect(res.status).toBe(400);
    });

    it("POST channel rejects name over 100 chars", async () => {
      const res = await app.request(`/api/v10/guilds/${defaultGuildId}/channels`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: "x".repeat(101) }),
      });
      expect(res.status).toBe(400);
    });

    it("POST user rejects username over 80 chars", async () => {
      const res = await app.request("/api/v10/users", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ username: "x".repeat(81) }),
      });
      expect(res.status).toBe(400);
    });

    it("PATCH channel rejects non-integer position", async () => {
      const res = await app.request("/api/v10/channels/general", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ position: 1.5 }),
      });
      expect(res.status).toBe(400);
    });

    it("PATCH channel rejects invalid type", async () => {
      const res = await app.request("/api/v10/channels/general", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ type: 99 }),
      });
      expect(res.status).toBe(400);
    });

    it("POST channel rejects invalid type", async () => {
      const res = await app.request(`/api/v10/guilds/${defaultGuildId}/channels`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: "test", type: 99 }),
      });
      expect(res.status).toBe(400);
    });

    it("POST channel rejects non-string topic", async () => {
      const res = await app.request(`/api/v10/guilds/${defaultGuildId}/channels`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: "test", topic: 123 }),
      });
      expect(res.status).toBe(400);
    });

    it("GET messages handles NaN limit gracefully", async () => {
      const res = await authGet("/api/v10/channels/general/messages?limit=abc");
      expect(res.status).toBe(200);
    });
  });
});
