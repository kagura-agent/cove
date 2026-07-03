import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import type { Channel, Role, Guild } from "@cove/shared";
import { API_PREFIX } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";

describe("Guild CRUD API", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let defaultGuildId: string;

  function authPost(path: string, body: unknown, token = adminToken) {
    return app.request(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function authPatch(path: string, body: unknown, token = adminToken) {
    return app.request(path, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function authDelete(path: string, token = adminToken) {
    return app.request(path, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  function authGet(path: string, token = adminToken) {
    return app.request(path, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  beforeEach(() => {
    db = initDb(":memory:");
    defaultGuildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, defaultGuildId);
    process.env.RATE_LIMIT_ENABLED = "false";
    app = createApp(db, createRepos(db), new GatewayDispatcher({ getById: () => null } as any));

    // Bootstrap admin user
    adminToken = "test-admin-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("admin", "Admin", null, 0, null, adminToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "admin", null, "[]", now);
    db.prepare("UPDATE guilds SET owner_id = ? WHERE id = ?").run("admin", defaultGuildId);
  });

  describe("POST /guilds", () => {
    it("creates guild with correct owner, @everyone role, and #general channel", async () => {
      const res = await authPost(`${API_PREFIX}/guilds`, { name: "Test Server" });
      expect(res.status).toBe(201);

      const data = await res.json() as { id: string; name: string; owner_id: string; roles: Role[]; channels: Channel[] };
      expect(data.name).toBe("Test Server");
      expect(data.owner_id).toBe("admin");

      // @everyone role with id = guild id
      expect(data.roles).toHaveLength(1);
      expect(data.roles[0].id).toBe(data.id);
      expect(data.roles[0].name).toBe("@everyone");

      // #general channel
      expect(data.channels).toHaveLength(1);
      expect(data.channels[0].name).toBe("general");
      expect(data.channels[0].guild_id).toBe(data.id);
    });

    it("creator is automatically a member", async () => {
      const createRes = await authPost(`${API_PREFIX}/guilds`, { name: "Member Test" });
      const guild = await createRes.json() as { id: string };

      const membersRes = await authGet(`${API_PREFIX}/guilds/${guild.id}/members`);
      expect(membersRes.status).toBe(200);
      const members = await membersRes.json() as Array<{ user: { id: string } }>;
      expect(members.some(m => m.user.id === "admin")).toBe(true);
    });

    it("rejects name shorter than 2 chars", async () => {
      const res = await authPost(`${API_PREFIX}/guilds`, { name: "X" });
      expect(res.status).toBe(400);
    });

    it("enforces max 10 guilds per user", async () => {
      // Admin already owns the seed guild (set in beforeEach), so can create 9 more
      for (let i = 0; i < 9; i++) {
        const res = await authPost(`${API_PREFIX}/guilds`, { name: `Guild ${i}` });
        expect(res.status).toBe(201);
      }
      // 11th (total) should fail — admin owns seed + 9 = 10
      const res = await authPost(`${API_PREFIX}/guilds`, { name: "One Too Many" });
      expect(res.status).toBe(403);
      const body = await res.json() as { message: string };
      expect(body.message).toContain("Maximum");
    });
  });

  describe("PATCH /guilds/:guildId", () => {
    it("owner can update name", async () => {
      const createRes = await authPost(`${API_PREFIX}/guilds`, { name: "Original" });
      const guild = await createRes.json() as { id: string };

      const patchRes = await authPatch(`${API_PREFIX}/guilds/${guild.id}`, { name: "Updated" });
      expect(patchRes.status).toBe(200);
      const updated = await patchRes.json() as Guild;
      expect(updated.name).toBe("Updated");
    });

    it("non-owner without MANAGE_GUILD is rejected", async () => {
      // Create a second user
      const now = Date.now();
      const otherToken = "other-user-token";
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("other", "Other", null, 0, null, otherToken, now, now);

      // Create guild as admin
      const createRes = await authPost(`${API_PREFIX}/guilds`, { name: "Admin Guild" });
      const guild = await createRes.json() as { id: string };

      // Add other as member (no special roles)
      db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
        .run(guild.id, "other", null, "[]", now);

      // Other tries to PATCH
      const patchRes = await authPatch(`${API_PREFIX}/guilds/${guild.id}`, { name: "Hacked" }, otherToken);
      expect(patchRes.status).toBe(403);
    });
  });

  describe("DELETE /guilds/:guildId", () => {
    it("owner can delete, cascades correctly", async () => {
      const createRes = await authPost(`${API_PREFIX}/guilds`, { name: "To Delete" });
      const guild = await createRes.json() as { id: string; channels: Channel[] };
      const channelId = guild.channels[0].id;

      // Post a message to the guild's channel
      await authPost(`${API_PREFIX}/channels/${channelId}/messages`, { content: "test" });

      // Delete guild
      const delRes = await authDelete(`${API_PREFIX}/guilds/${guild.id}`);
      expect(delRes.status).toBe(204);

      // Verify guild is gone
      const getRes = await authGet(`${API_PREFIX}/guilds/${guild.id}/channels`);
      expect(getRes.status).toBe(404);

      // Verify channels are gone
      const chRes = await authGet(`${API_PREFIX}/channels/${channelId}`);
      expect(chRes.status).toBe(404);
    });

    it("non-owner is rejected", async () => {
      const now = Date.now();
      const otherToken = "other-user-token-2";
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("other2", "Other2", null, 0, null, otherToken, now, now);

      const createRes = await authPost(`${API_PREFIX}/guilds`, { name: "Protected" });
      const guild = await createRes.json() as { id: string };

      // Add other as member
      db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
        .run(guild.id, "other2", null, "[]", now);

      const delRes = await authDelete(`${API_PREFIX}/guilds/${guild.id}`, otherToken);
      expect(delRes.status).toBe(403);
    });

    it("cannot delete seed guild (owner_id NULL)", async () => {
      // The default guild has owner_id set to 'admin' in beforeEach,
      // let's set it to NULL to simulate seed guild
      db.prepare("UPDATE guilds SET owner_id = NULL WHERE id = ?").run(defaultGuildId);

      const delRes = await authDelete(`${API_PREFIX}/guilds/${defaultGuildId}`);
      expect(delRes.status).toBe(403);
      const body = await delRes.json() as { message: string };
      expect(body.message).toContain("seed");
    });
  });

  describe("Channel scoping", () => {
    it("channels are scoped to their guild", async () => {
      const res1 = await authPost(`${API_PREFIX}/guilds`, { name: "Guild A" });
      const guildA = await res1.json() as { id: string; channels: Channel[] };

      const res2 = await authPost(`${API_PREFIX}/guilds`, { name: "Guild B" });
      const guildB = await res2.json() as { id: string; channels: Channel[] };

      // Channels from guild A list should not include guild B channels
      const chA = await authGet(`${API_PREFIX}/guilds/${guildA.id}/channels`);
      const channelsA = await chA.json() as Channel[];
      expect(channelsA.every(ch => ch.guild_id === guildA.id)).toBe(true);

      const chB = await authGet(`${API_PREFIX}/guilds/${guildB.id}/channels`);
      const channelsB = await chB.json() as Channel[];
      expect(channelsB.every(ch => ch.guild_id === guildB.id)).toBe(true);

      // No overlap
      const idsA = channelsA.map(c => c.id);
      const idsB = channelsB.map(c => c.id);
      expect(idsA.filter(id => idsB.includes(id))).toHaveLength(0);
    });

    it("members of guild A cannot see guild B channels", async () => {
      const now = Date.now();
      const userBToken = "user-b-token";
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("user-b", "UserB", null, 0, null, userBToken, now, now);
      db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
        .run(defaultGuildId, "user-b", null, "[]", now);

      // Admin creates guild A
      const res = await authPost(`${API_PREFIX}/guilds`, { name: "Private Guild" });
      const guildA = await res.json() as { id: string };

      // User B is NOT a member of guild A, so they shouldn't see its channels
      const chRes = await authGet(`${API_PREFIX}/guilds/${guildA.id}/channels`, userBToken);
      expect(chRes.status).toBe(404); // unknownGuild because not a member
    });
  });

  describe("POST /guilds/:guildId/invite-agent", () => {
    it("owner can invite an agent (201, returns token + invite letter)", async () => {
      const res = await authPost(`${API_PREFIX}/guilds/${defaultGuildId}/invite-agent`, { name: "TestBot" });
      expect(res.status).toBe(201);

      const data = await res.json() as { agentName: string; token: string; inviteLetter: string; agentId: string };
      expect(data.agentName).toBe("TestBot");
      expect(data.token).toBeTruthy();
      expect(data.inviteLetter).toContain("TestBot");
      expect(data.agentId).toBeTruthy();
    });

    it("non-owner without MANAGE_GUILD gets 403", async () => {
      const now = Date.now();
      const memberToken = "member-token-invite";
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("member-invite", "Member", null, 0, null, memberToken, now, now);
      db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
        .run(defaultGuildId, "member-invite", null, "[]", now);

      const res = await authPost(`${API_PREFIX}/guilds/${defaultGuildId}/invite-agent`, { name: "HackerBot" }, memberToken);
      expect(res.status).toBe(403);
    });

    it("re-invite same-name bot returns 409 by default", async () => {
      // First invite succeeds
      const res1 = await authPost(`${API_PREFIX}/guilds/${defaultGuildId}/invite-agent`, { name: "DupeBot" });
      expect(res1.status).toBe(201);

      // Second invite same name should 409
      const res2 = await authPost(`${API_PREFIX}/guilds/${defaultGuildId}/invite-agent`, { name: "DupeBot" });
      expect(res2.status).toBe(409);
    });

    it("re-invite with { rotate: true } succeeds and returns new token", async () => {
      // First invite
      const res1 = await authPost(`${API_PREFIX}/guilds/${defaultGuildId}/invite-agent`, { name: "RotateBot" });
      expect(res1.status).toBe(201);
      const data1 = await res1.json() as { token: string };

      // Re-invite with rotate
      const res2 = await authPost(`${API_PREFIX}/guilds/${defaultGuildId}/invite-agent`, { name: "RotateBot", rotate: true });
      expect(res2.status).toBe(201);
      const data2 = await res2.json() as { token: string };

      // Token should have changed
      expect(data2.token).toBeTruthy();
      expect(data2.token).not.toBe(data1.token);
    });

    it("invalid agent name (special chars) gets 400", async () => {
      const res = await authPost(`${API_PREFIX}/guilds/${defaultGuildId}/invite-agent`, { name: "bad bot!@#" });
      expect(res.status).toBe(400);
    });

    it("bot user cannot invite agents (403)", async () => {
      const now = Date.now();
      const botToken = "bot-invite-token";
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("bot-inviter", "BotInviter", null, 1, null, botToken, now, now);
      db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
        .run(defaultGuildId, "bot-inviter", null, "[]", now);
      // Make it owner to isolate the bot check from permission check
      db.prepare("UPDATE guilds SET owner_id = ? WHERE id = ?").run("bot-inviter", defaultGuildId);

      const res = await authPost(`${API_PREFIX}/guilds/${defaultGuildId}/invite-agent`, { name: "SubBot" }, botToken);
      expect(res.status).toBe(403);
    });
  });
});
