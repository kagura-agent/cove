import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import type { Message, CoveAgent } from "@cove/shared";
import { API_PREFIX, PermissionFlags } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";

describe("Display name (global_name)", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let defaultGuildId: string;
  let generalId: string;

  class TestDispatcher extends GatewayDispatcher {
    constructor() {
      super({ getById: () => null } as any);
    }
    override messageCreate(_msg: Message): void {}
    override messageAck(): void {}
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
      .run("admin", "Admin", null, 0, null, adminToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "admin", null, "[]", now);
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_ENABLED;
  });

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken}`,
  });

  it("PATCH /users/@me with valid global_name updates display name", async () => {
    const res = await app.request(`${API_PREFIX}/users/@me`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ global_name: "Cool Admin" }),
    });
    expect(res.status).toBe(200);
    const user: CoveAgent = await res.json();
    expect(user.global_name).toBe("Cool Admin");
  });

  it("PATCH /users/@me rejects global_name over 80 characters", async () => {
    const res = await app.request(`${API_PREFIX}/users/@me`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ global_name: "x".repeat(81) }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /users/@me with null clears global_name", async () => {
    // First set a display name
    await app.request(`${API_PREFIX}/users/@me`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ global_name: "Temp Name" }),
    });

    // Now clear it
    const res = await app.request(`${API_PREFIX}/users/@me`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ global_name: null }),
    });
    expect(res.status).toBe(200);
    const user: CoveAgent = await res.json();
    expect(user.global_name).toBeNull();
  });

  it("PATCH /users/@me with empty string normalizes to null", async () => {
    // First set a display name
    await app.request(`${API_PREFIX}/users/@me`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ global_name: "Before" }),
    });

    // Send empty string — should be normalized to null
    const res = await app.request(`${API_PREFIX}/users/@me`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ global_name: "" }),
    });
    expect(res.status).toBe(200);
    const user: CoveAgent = await res.json();
    expect(user.global_name).toBeNull();
  });

  it("PATCH /users/@me with whitespace-only string normalizes to null", async () => {
    const res = await app.request(`${API_PREFIX}/users/@me`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ global_name: "   " }),
    });
    expect(res.status).toBe(200);
    const user: CoveAgent = await res.json();
    expect(user.global_name).toBeNull();
  });

  it("PATCH /users/@me rejects control characters in global_name", async () => {
    const res = await app.request(`${API_PREFIX}/users/@me`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ global_name: "bad\x00name" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /users/@me rejects zero-width characters in global_name", async () => {
    const res = await app.request(`${API_PREFIX}/users/@me`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ global_name: "invisible\u200Bchar" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /users/@me rejects RTL override in global_name", async () => {
    const res = await app.request(`${API_PREFIX}/users/@me`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ global_name: "rtl\u202Eoverride" }),
    });
    expect(res.status).toBe(400);
  });

  it("message author includes global_name (round-trip)", async () => {
    // Create a bot with a display name
    const createRes = await app.request(`${API_PREFIX}/users`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ id: "display-bot", username: "DisplayBot", bot: true }),
    });
    const bot = await createRes.json() as CoveAgent & { token: string };

    // Set display name
    await app.request(`${API_PREFIX}/users/display-bot`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bot ${bot.token}` },
      body: JSON.stringify({ global_name: "Friendly Bot" }),
    });

    // Grant channel access and send a message
    await app.request(`${API_PREFIX}/channels/${generalId}/permissions/display-bot`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ type: 1, allow: PermissionFlags.VIEW_CHANNEL, deny: "0" }),
    });

    const msgRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bot ${bot.token}` },
      body: JSON.stringify({ content: "hello with display name" }),
    });
    expect(msgRes.status).toBe(201);
    const msg: Message = await msgRes.json();
    expect(msg.author.global_name).toBe("Friendly Bot");
    expect(msg.author.username).toBe("DisplayBot");
  });
});
