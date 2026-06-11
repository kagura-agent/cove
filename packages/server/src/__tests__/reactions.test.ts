import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import { API_PREFIX } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";

describe("Reactions", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let generalId: string;
  let defaultGuildId: string;
  let messageId: string;

  class TestDispatcher extends GatewayDispatcher {
    constructor() {
      super({ getById: () => null } as any);
    }
    override reactionAdd() {}
    override reactionRemove() {}
  }

  beforeEach(() => {
    db = initDb(":memory:");
    defaultGuildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, defaultGuildId);
    generalId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;
    process.env.RATE_LIMIT_ENABLED = "false";
    app = createApp(db, createRepos(db), new TestDispatcher());

    adminToken = "test-admin-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("admin", "Admin", null, 1, null, adminToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "admin", null, "[]", now);

    // Grant VIEW_CHANNEL to the bot admin so route tests pass
    db.prepare("INSERT INTO channel_permission_overwrites (channel_id, target_id, target_type, allow, deny) VALUES (?, ?, ?, ?, ?)")
      .run(generalId, "admin", 1, "1024", "0");
    const randomId = (db.prepare("SELECT id FROM channels WHERE name = 'random'").get() as { id: string }).id;
    db.prepare("INSERT INTO channel_permission_overwrites (channel_id, target_id, target_type, allow, deny) VALUES (?, ?, ?, ?, ?)")
      .run(randomId, "admin", 1, "1024", "0");

    // Create a message to react to
    db.prepare("INSERT INTO messages (id, channel_id, sender, content, timestamp) VALUES (?, ?, ?, ?, ?)")
      .run("msg1", generalId, "admin", "Hello", now);
    messageId = "msg1";
  });

  const auth = () => ({ "Content-Type": "application/json", Authorization: `Bot ${adminToken}` });

  describe("ReactionsRepo", () => {
    it("add is idempotent", () => {
      const repos = createRepos(db);
      expect(repos.reactions.add(messageId, "admin", "👍")).toBe(true);
      expect(repos.reactions.add(messageId, "admin", "👍")).toBe(false);
    });

    it("remove returns false when not present", () => {
      const repos = createRepos(db);
      expect(repos.reactions.remove(messageId, "admin", "👍")).toBe(false);
    });

    it("remove works after add", () => {
      const repos = createRepos(db);
      repos.reactions.add(messageId, "admin", "👍");
      expect(repos.reactions.remove(messageId, "admin", "👍")).toBe(true);
      expect(repos.reactions.remove(messageId, "admin", "👍")).toBe(false);
    });

    it("getForMessage returns aggregated reactions", () => {
      const repos = createRepos(db);
      const now = Date.now();
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("user2", "User2", null, 0, null, "tok2", now, now);
      db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
        .run(defaultGuildId, "user2", null, "[]", now);

      repos.reactions.add(messageId, "admin", "👍");
      // Ensure distinct timestamps for ordering
      db.prepare("UPDATE reactions SET created_at = ? WHERE message_id = ? AND user_id = ? AND emoji = ?")
        .run(1000, messageId, "admin", "👍");
      repos.reactions.add(messageId, "user2", "👍");
      db.prepare("UPDATE reactions SET created_at = ? WHERE message_id = ? AND user_id = ? AND emoji = ?")
        .run(1001, messageId, "user2", "👍");
      repos.reactions.add(messageId, "admin", "❤️");
      db.prepare("UPDATE reactions SET created_at = ? WHERE message_id = ? AND user_id = ? AND emoji = ?")
        .run(1002, messageId, "admin", "❤️");

      const reactions = repos.reactions.getForMessage(messageId, "admin");
      expect(reactions).toHaveLength(2);
      expect(reactions[0].emoji.name).toBe("👍");
      expect(reactions[0].count).toBe(2);
      expect(reactions[0].me).toBe(true);
      expect(reactions[1].emoji.name).toBe("❤️");
      expect(reactions[1].count).toBe(1);
      expect(reactions[1].me).toBe(true);
    });

    it("getForMessages batch works", () => {
      const repos = createRepos(db);
      const now = Date.now();
      db.prepare("INSERT INTO messages (id, channel_id, sender, content, timestamp) VALUES (?, ?, ?, ?, ?)")
        .run("msg2", generalId, "admin", "World", now);

      repos.reactions.add("msg1", "admin", "👍");
      repos.reactions.add("msg2", "admin", "❤️");

      const result = repos.reactions.getForMessages(["msg1", "msg2"], "admin");
      expect(result.get("msg1")).toHaveLength(1);
      expect(result.get("msg2")).toHaveLength(1);
      expect(result.get("msg1")![0].emoji.name).toBe("👍");
      expect(result.get("msg2")![0].emoji.name).toBe("❤️");
    });
  });

  describe("Routes", () => {
    it("PUT reaction returns 204", async () => {
      const res = await app.request(
        `${API_PREFIX}/channels/${generalId}/messages/${messageId}/reactions/👍/@me`,
        { method: "PUT", headers: auth() },
      );
      expect(res.status).toBe(204);
    });

    it("PUT reaction is idempotent (second call still 204)", async () => {
      await app.request(`${API_PREFIX}/channels/${generalId}/messages/${messageId}/reactions/👍/@me`, { method: "PUT", headers: auth() });
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/messages/${messageId}/reactions/👍/@me`, { method: "PUT", headers: auth() });
      expect(res.status).toBe(204);
    });

    it("DELETE reaction returns 204", async () => {
      await app.request(`${API_PREFIX}/channels/${generalId}/messages/${messageId}/reactions/👍/@me`, { method: "PUT", headers: auth() });
      const res = await app.request(
        `${API_PREFIX}/channels/${generalId}/messages/${messageId}/reactions/👍/@me`,
        { method: "DELETE", headers: auth() },
      );
      expect(res.status).toBe(204);
    });

    it("GET users returns reactor list", async () => {
      await app.request(`${API_PREFIX}/channels/${generalId}/messages/${messageId}/reactions/👍/@me`, { method: "PUT", headers: auth() });
      const res = await app.request(
        `${API_PREFIX}/channels/${generalId}/messages/${messageId}/reactions/👍`,
        { headers: { Authorization: `Bot ${adminToken}` } },
      );
      expect(res.status).toBe(200);
      const users = await res.json();
      expect(users).toHaveLength(1);
      expect(users[0].id).toBe("admin");
    });

    it("invalid emoji (too long) returns 400", async () => {
      const longEmoji = "a".repeat(65);
      const res = await app.request(
        `${API_PREFIX}/channels/${generalId}/messages/${messageId}/reactions/${longEmoji}/@me`,
        { method: "PUT", headers: auth() },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBe("Invalid emoji");
    });

    it("message not in channel returns 404", async () => {
      const randomId = (db.prepare("SELECT id FROM channels WHERE name = 'random'").get() as { id: string }).id;
      const res = await app.request(
        `${API_PREFIX}/channels/${randomId}/messages/${messageId}/reactions/👍/@me`,
        { method: "PUT", headers: auth() },
      );
      // msg1 belongs to generalId, not randomId — should be 404
      expect(res.status).toBe(404);
    });
  });

  describe("CASCADE delete", () => {
    it("deleting a message removes its reactions", () => {
      const repos = createRepos(db);
      repos.reactions.add(messageId, "admin", "👍");
      repos.reactions.add(messageId, "admin", "❤️");

      // Verify reactions exist
      expect(repos.reactions.getForMessage(messageId)).toHaveLength(2);

      // Delete the message
      db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);

      // Reactions should be gone
      expect(repos.reactions.getForMessage(messageId)).toHaveLength(0);
    });
  });
});
