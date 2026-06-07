import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import { SESSION_TTL_MS } from "../repos/users.js";
import type Database from "better-sqlite3";
import { GatewayDispatcher } from "../ws/dispatcher.js";
import type { OAuthConfig } from "../routes/auth.js";
import type { Repos } from "../repos/index.js";

describe("Session TTL & Cleanup (#118)", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let repos: Repos;
  let defaultGuildId: string;

  const oauthConfig: OAuthConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/api/auth/callback",
  };

  class TestDispatcher extends GatewayDispatcher {
    constructor() {
      super({ getById: () => null } as any);
    }
  }

  beforeEach(() => {
    db = initDb(":memory:");
    defaultGuildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, defaultGuildId);
    repos = createRepos(db);
    app = createApp(db, repos, new TestDispatcher(), { oauth: oauthConfig });
  });

  // ─── Expired token returns 401 ────────────────────────────────────────

  it("expired token returns 401 on /api/auth/me", async () => {
    const now = Date.now();
    const expiredAt = now - 1000; // already expired
    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("expired-user", "ExpiredUser", null, 0, null, "expired-token", now, now, expiredAt);
    db.prepare(
      "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
    ).run(defaultGuildId, "expired-user", null, "[]", now);

    const res = await app.request("/api/auth/me", {
      headers: { Authorization: "Bearer expired-token" },
    });
    expect(res.status).toBe(401);

    // Verify the user row was deleted (lazy cleanup)
    const row = db.prepare("SELECT id FROM users WHERE id = ?").get("expired-user");
    expect(row).toBeUndefined();
  });

  // ─── Bot token (expires_at=null) never expires ────────────────────────

  it("bot token with null expires_at never expires", async () => {
    const now = Date.now();
    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("bot-user", "BotUser", null, 1, null, "bot-token", now, now, null);
    db.prepare(
      "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
    ).run(defaultGuildId, "bot-user", null, "[]", now);

    const res = await app.request("/api/auth/me", {
      headers: { Authorization: "Bot bot-token" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("bot-user");
    expect(data.bot).toBe(true);
    expect(data.expires_at).toBeNull();
  });

  // ─── Cleanup removes expired but keeps valid ──────────────────────────

  it("cleanupExpired removes expired sessions but keeps valid ones", () => {
    const now = Date.now();

    // Expired human user
    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("stale-user", "StaleUser", null, 0, null, "stale-token", now, now, now - 1000);

    // Valid human user (expires in the future)
    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("fresh-user", "FreshUser", null, 0, null, "fresh-token", now, now, now + SESSION_TTL_MS);

    // Bot user (never expires)
    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("bot-user", "BotUser", null, 1, null, "bot-token-2", now, now, null);

    const deleted = repos.users.cleanupExpired();
    expect(deleted).toBe(1);

    // Stale user should be gone
    expect(db.prepare("SELECT id FROM users WHERE id = ?").get("stale-user")).toBeUndefined();

    // Fresh user and bot should remain
    expect(db.prepare("SELECT id FROM users WHERE id = ?").get("fresh-user")).toBeTruthy();
    expect(db.prepare("SELECT id FROM users WHERE id = ?").get("bot-user")).toBeTruthy();
  });

  // ─── create() sets expires_at correctly ───────────────────────────────

  it("create() sets expires_at for human users and null for bots", () => {
    const before = Date.now();
    const human = repos.users.create({ username: "Human", bot: false }, defaultGuildId);
    const bot = repos.users.create({ username: "Robot", bot: true }, defaultGuildId);
    const after = Date.now();

    const humanRow = db.prepare("SELECT expires_at FROM users WHERE id = ?").get(human.id) as { expires_at: number | null };
    const botRow = db.prepare("SELECT expires_at FROM users WHERE id = ?").get(bot.id) as { expires_at: number | null };

    expect(humanRow.expires_at).toBeGreaterThanOrEqual(before + SESSION_TTL_MS);
    expect(humanRow.expires_at).toBeLessThanOrEqual(after + SESSION_TTL_MS);
    expect(botRow.expires_at).toBeNull();
  });

  // ─── refreshTTL extends session ───────────────────────────────────────

  it("refreshTTL updates expires_at for non-bot users", () => {
    const now = Date.now();
    const oldExpiresAt = now + 1000; // about to expire
    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("ttl-user", "TTLUser", null, 0, null, "ttl-token", now, now, oldExpiresAt);

    repos.users.refreshTTL("ttl-user");

    const row = db.prepare("SELECT expires_at FROM users WHERE id = ?").get("ttl-user") as { expires_at: number };
    expect(row.expires_at).toBeGreaterThan(oldExpiresAt);
    expect(row.expires_at).toBeGreaterThanOrEqual(Date.now() + SESSION_TTL_MS - 1000);
  });

  // ─── /api/auth/me returns expires_at ──────────────────────────────────

  it("/api/auth/me returns expires_at in response", async () => {
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("me-user", "MeUser", null, 0, null, "me-token", now, now, expiresAt);
    db.prepare(
      "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
    ).run(defaultGuildId, "me-user", null, "[]", now);

    const res = await app.request("/api/auth/me", {
      headers: { Authorization: "Bearer me-token" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.expires_at).toBe(expiresAt);
  });
});
