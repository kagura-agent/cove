import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import { API_PREFIX } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";
import { resetBuckets } from "../middleware/rate-limit.js";

describe("Rate-limit middleware", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let defaultGuildId: string;
  let generalId: string;

  class TestDispatcher extends GatewayDispatcher {
    constructor() { super({ getById: () => null } as any); }
  }

  beforeEach(() => {
    // Ensure rate limiting is enabled
    delete process.env.RATE_LIMIT_ENABLED;

    db = initDb(":memory:");
    defaultGuildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, defaultGuildId);
    generalId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;
    app = createApp(db, createRepos(db), new TestDispatcher());

    adminToken = "test-admin-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("admin", "Admin", null, 1, null, adminToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "admin", null, "[]", now);

    resetBuckets();
  });

  afterEach(() => {
    resetBuckets();
  });

  const authGet = (path: string, token = adminToken) =>
    app.request(path, { headers: { Authorization: `Bot ${token}` } });

  const authPost = (path: string, body: object, token = adminToken) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bot ${token}` },
      body: JSON.stringify(body),
    });

  // ─── Normal requests include rate-limit headers ─────────────────────

  it("includes X-RateLimit-* headers on normal requests", async () => {
    const res = await authGet(`${API_PREFIX}/users/@me`);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("50");
    expect(res.headers.get("X-RateLimit-Remaining")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Reset-After")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Bucket")).toBe("global");
  });

  // ─── Exceeding limit returns 429 ───────────────────────────────────

  it("returns 429 when global limit is exceeded", async () => {
    // Exhaust the global bucket (50 requests)
    for (let i = 0; i < 50; i++) {
      const res = await authGet(`${API_PREFIX}/users/@me`);
      expect(res.status).toBe(200);
    }

    // 51st request should be rate limited
    const res = await authGet(`${API_PREFIX}/users/@me`);
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.message).toBe("You are being rate limited.");
    expect(typeof body.retry_after).toBe("number");
    expect(body.global).toBe(false);
    expect(body.code).toBe(0);

    // Check Retry-After header
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Bucket")).toBe("global");
  });

  // ─── Channel-write bucket is more restrictive ─────────────────────

  it("returns 429 for channel writes after 5 requests", async () => {
    // Exhaust channel-write bucket (5 requests)
    for (let i = 0; i < 5; i++) {
      const res = await authPost(
        `${API_PREFIX}/channels/${generalId}/messages`,
        { content: `message ${i}` },
      );
      expect([200, 201]).toContain(res.status);
    }

    // 6th write should be rate limited
    const res = await authPost(
      `${API_PREFIX}/channels/${generalId}/messages`,
      { content: "one too many" },
    );
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.message).toBe("You are being rate limited.");
    expect(res.headers.get("X-RateLimit-Bucket")).toBe("channel_write");
  });

  // ─── Different users have independent buckets ──────────────────────

  it("different users have independent rate-limit buckets", async () => {
    const now = Date.now();

    // Create a second user
    const secondToken = "test-second-token";
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("user2", "User2", null, 1, null, secondToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "user2", null, "[]", now);

    // Exhaust admin's global bucket
    for (let i = 0; i < 50; i++) {
      await authGet(`${API_PREFIX}/users/@me`, adminToken);
    }

    // Admin is now rate limited
    const adminRes = await authGet(`${API_PREFIX}/users/@me`, adminToken);
    expect(adminRes.status).toBe(429);

    // User2 should still be fine
    const user2Res = await authGet(`${API_PREFIX}/users/@me`, secondToken);
    expect(user2Res.status).toBe(200);
    expect(user2Res.headers.get("X-RateLimit-Remaining")).toBe("49");
  });

  // ─── Disabled via env flag ─────────────────────────────────────────

  it("skips rate limiting when RATE_LIMIT_ENABLED=false", async () => {
    process.env.RATE_LIMIT_ENABLED = "false";

    // Make more than 50 requests — should all succeed
    for (let i = 0; i < 55; i++) {
      const res = await authGet(`${API_PREFIX}/users/@me`);
      expect(res.status).toBe(200);
    }

    delete process.env.RATE_LIMIT_ENABLED;
  });

  // ─── Unauthenticated requests skip rate limiting ───────────────────

  it("does not apply rate limiting to unauthenticated requests", async () => {
    // Health endpoint is public, no auth needed
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBeNull();
  });
});
