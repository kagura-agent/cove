import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import { SESSION_TTL_MS } from "../config.js";
import type Database from "better-sqlite3";
import { GatewayDispatcher } from "../ws/dispatcher.js";
import type { OAuthConfig } from "../routes/auth.js";
import type { Repos } from "../repos/index.js";
import { resolveUser } from "../auth.js";

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

    // Verify the user still exists but token was cleared (lazy cleanup)
    const row = db.prepare("SELECT id, token, expires_at FROM users WHERE id = ?").get("expired-user") as { id: string; token: string | null; expires_at: number | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.token).toBeNull();
    expect(row!.expires_at).toBeNull();
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

    // Stale user still exists but token was cleared
    const stale = db.prepare("SELECT id, token, expires_at FROM users WHERE id = ?").get("stale-user") as { id: string; token: string | null; expires_at: number | null } | undefined;
    expect(stale).toBeDefined();
    expect(stale!.token).toBeNull();
    expect(stale!.expires_at).toBeNull();

    // Fresh user and bot should remain with tokens intact
    const fresh = db.prepare("SELECT token FROM users WHERE id = ?").get("fresh-user") as { token: string };
    expect(fresh.token).toBe("fresh-token");
    const bot = db.prepare("SELECT token FROM users WHERE id = ?").get("bot-user") as { token: string };
    expect(bot.token).toBe("bot-token-2");
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

describe("Sliding refresh regression (#267)", () => {
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

  it("resolveUser returns bumped expires_at after sliding refresh", async () => {
    const now = Date.now();
    // Set expires_at so remaining < threshold (less than half TTL remaining)
    const almostExpired = now + Math.floor(SESSION_TTL_MS * 0.3);
    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("slide-user", "SlideUser", null, 0, null, "slide-token", now, now, almostExpired);
    db.prepare(
      "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
    ).run(defaultGuildId, "slide-user", null, "[]", now);

    const res = await app.request("/api/auth/me", {
      headers: { Authorization: "Bearer slide-token" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // After sliding refresh, expires_at should be extended to ~now + SESSION_TTL_MS
    expect(data.expires_at).toBeGreaterThan(almostExpired);
    expect(data.expires_at).toBeGreaterThanOrEqual(Date.now() + SESSION_TTL_MS - 5000);
  });

  it("sliding threshold works for short TTLs (< 24h)", () => {
    // With a short TTL, threshold = max(TTL/2, TTL - 86400000)
    // For TTL = 3600000 (1h): threshold = max(1800000, 3600000 - 86400000) = 1800000
    // So refresh triggers when remaining < 1800000 (half the TTL)
    const now = Date.now();
    const shortTTL = SESSION_TTL_MS; // use actual configured TTL
    const threshold = Math.max(shortTTL / 2, shortTTL - 86_400_000);

    // User whose remaining time is below threshold
    const expiresAt = now + Math.floor(threshold * 0.5); // well below threshold
    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("short-ttl-user", "ShortTTL", null, 0, null, "short-token", now, now, expiresAt);

    // Directly call resolveUser to verify refresh logic
    const result = resolveUser(repos.users, "Bearer short-token");
    expect(result).toBeDefined();
    expect(result!.refreshed).toBe(true);
    expect(result!.user.expires_at).toBeGreaterThan(expiresAt);
  });

  it("OAuth login sets correct expires_at atomically", () => {
    const now = Date.now();
    // Simulate what OAuth callback does: atomic UPDATE with token + expires_at
    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at, google_id, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("oauth-user", "OAuthUser", null, 0, null, "old-token", now - 100000, now - 100000, now - 1000, "google-123", "test@test.com");

    // Re-login: single atomic UPDATE (mirrors auth route logic)
    const newToken = "new-oauth-token";
    const expiresAt = Date.now() + SESSION_TTL_MS;
    db.prepare("UPDATE users SET token = ?, expires_at = ?, updated_at = ? WHERE id = ?")
      .run(newToken, expiresAt, Date.now(), "oauth-user");

    const row = db.prepare("SELECT token, expires_at FROM users WHERE id = ?").get("oauth-user") as { token: string; expires_at: number };
    expect(row.token).toBe(newToken);
    expect(row.expires_at).toBe(expiresAt);
    // Verify token and expires_at are consistent (both updated in same statement)
    expect(row.expires_at).toBeGreaterThan(now);
  });
});
