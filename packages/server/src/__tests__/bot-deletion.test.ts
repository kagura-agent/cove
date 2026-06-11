import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import type { CoveAgent } from "@cove/shared";
import { API_PREFIX } from "@cove/shared";

describe("Bot deletion by another bot user", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let defaultGuildId: string;

  beforeEach(() => {
    db = initDb(":memory:");
    defaultGuildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, defaultGuildId);
    process.env.RATE_LIMIT_ENABLED = "false";
    app = createApp(db, createRepos(db));

    adminToken = "test-admin-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("admin", "Admin", null, 1, null, adminToken, now, now);
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

  async function createBotUser(id: string, username: string) {
    const res = await app.request(`${API_PREFIX}/users`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ id, username, bot: true }),
    });
    return res.json() as Promise<CoveAgent & { token: string }>;
  }

  it("bot user can delete another bot user", async () => {
    const target = await createBotUser("target-bot", "TargetBot");

    const res = await app.request(`${API_PREFIX}/users/${target.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${adminToken}` },
    });
    expect(res.status).toBe(204);

    const getRes = await app.request(`${API_PREFIX}/users/${target.id}`, {
      headers: { Authorization: `Bot ${adminToken}` },
    });
    expect(getRes.status).toBe(404);
  });

  it("non-bot user can delete a bot user", async () => {
    const now = Date.now();
    const humanToken = "human-token";
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("human", "Human", null, 0, null, humanToken, now, now, now + 86400000);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "human", null, "[]", now);

    const target = await createBotUser("target-bot2", "TargetBot2");

    const res = await app.request(`${API_PREFIX}/users/${target.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${humanToken}` },
    });
    expect(res.status).toBe(204);
  });

  it("non-bot user cannot delete another non-bot user", async () => {
    const now = Date.now();
    const humanToken = "human-token-2";
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("human-a", "HumanA", null, 0, null, humanToken, now, now, now + 86400000);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "human-a", null, "[]", now);

    const humanToken2 = "human-token-3";
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("human-b", "HumanB", null, 0, null, humanToken2, now, now, now + 86400000);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "human-b", null, "[]", now);

    const res = await app.request(`${API_PREFIX}/users/human-b`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${humanToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("user can still delete themselves", async () => {
    const bot = await createBotUser("self-del", "SelfDel");

    const res = await app.request(`${API_PREFIX}/users/self-del`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${bot.token}` },
    });
    expect(res.status).toBe(204);
  });

  it("delete returns 404 for nonexistent user", async () => {
    const res = await app.request(`${API_PREFIX}/users/nonexistent`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${adminToken}` },
    });
    expect(res.status).toBe(404);
  });
});
