import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import type { Message, Webhook } from "@cove/shared";
import { API_PREFIX } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";

describe("Webhooks", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  const broadcastEvents: { t: string; d: unknown }[] = [];
  let adminToken: string;
  let defaultGuildId: string;
  let generalId: string;

  class TestDispatcher extends GatewayDispatcher {
    constructor() {
      super({ getById: () => null } as any);
    }
    override messageCreate(message: Message): void {
      broadcastEvents.push({ t: "MESSAGE_CREATE", d: message });
    }
  }

  beforeEach(() => {
    db = initDb(":memory:");
    defaultGuildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, defaultGuildId);
    generalId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;
    broadcastEvents.length = 0;
    process.env.RATE_LIMIT_ENABLED = "false";
    app = createApp(db, createRepos(db), new TestDispatcher());

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

  async function createWebhook(channelId: string, name: string): Promise<Webhook> {
    const res = await app.request(`${API_PREFIX}/channels/${channelId}/webhooks`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name }),
    });
    return res.json() as Promise<Webhook>;
  }

  // ─── Create ─────────────────────────────────────────────────────────

  it("creates a webhook and returns token", async () => {
    const res = await app.request(`${API_PREFIX}/channels/${generalId}/webhooks`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Test Hook" }),
    });
    expect(res.status).toBe(201);
    const wh: Webhook = await res.json();
    expect(wh.name).toBe("Test Hook");
    expect(wh.channel_id).toBe(generalId);
    expect(wh.guild_id).toBe(defaultGuildId);
    expect(wh.token).toBeTruthy();
    expect(wh.id).toBeTruthy();
  });

  // ─── Execute ────────────────────────────────────────────────────────

  it("executes a webhook and creates a message", async () => {
    const wh = await createWebhook(generalId, "Exec Hook");
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello from webhook" }),
    });
    expect(res.status).toBe(201);
    const msg: Message = await res.json();
    expect(msg.content).toBe("Hello from webhook");
    expect(msg.webhook_id).toBe(wh.id);
    expect(msg.author.bot).toBe(true);
    expect(msg.author.username).toBe("Exec Hook");
  });

  it("execute with invalid token returns 404", async () => {
    const wh = await createWebhook(generalId, "Bad Token");
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/invalid-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("execute with missing content returns 400", async () => {
    const wh = await createWebhook(generalId, "No Content");
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("execute with username override uses override", async () => {
    const wh = await createWebhook(generalId, "Default Name");
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "custom", username: "Custom Bot" }),
    });
    expect(res.status).toBe(201);
    const msg: Message = await res.json();
    expect(msg.author.username).toBe("Custom Bot");
  });

  // ─── Webhook message identity persists on reload ────────────────────

  it("webhook message retains identity when fetched from DB", async () => {
    const wh = await createWebhook(generalId, "Persist Hook");
    await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "persist test" }),
    });

    const listRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
      headers: { Authorization: `Bot ${adminToken}` },
    });
    const msgs: Message[] = await listRes.json();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].author.bot).toBe(true);
    expect(msgs[0].author.username).toBe("Persist Hook");
    expect(msgs[0].author.id).toBe(wh.id);
    expect(msgs[0].webhook_id).toBe(wh.id);
  });

  // ─── List — no token ────────────────────────────────────────────────

  it("list webhooks does NOT include token", async () => {
    await createWebhook(generalId, "Listed Hook");
    const res = await app.request(`${API_PREFIX}/channels/${generalId}/webhooks`, {
      headers: { Authorization: `Bot ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const hooks = await res.json() as Webhook[];
    expect(hooks).toHaveLength(1);
    expect(hooks[0].name).toBe("Listed Hook");
    expect(hooks[0]).not.toHaveProperty("token");
  });

  // ─── Get — no token ─────────────────────────────────────────────────

  it("get webhook does NOT include token", async () => {
    const wh = await createWebhook(generalId, "Get Hook");
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}`, {
      headers: { Authorization: `Bot ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const got = await res.json() as Webhook;
    expect(got.name).toBe("Get Hook");
    expect(got).not.toHaveProperty("token");
  });

  // ─── Delete ─────────────────────────────────────────────────────────

  it("deletes a webhook", async () => {
    const wh = await createWebhook(generalId, "Delete Me");
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${adminToken}` },
    });
    expect(res.status).toBe(204);

    const getRes = await app.request(`${API_PREFIX}/webhooks/${wh.id}`, {
      headers: { Authorization: `Bot ${adminToken}` },
    });
    expect(getRes.status).toBe(404);
  });

  // ─── Validation on execute ──────────────────────────────────────────

  it("execute rejects username over 80 chars", async () => {
    const wh = await createWebhook(generalId, "Val Hook");
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hi", username: "x".repeat(81) }),
    });
    expect(res.status).toBe(400);
  });

  it("execute rejects avatar_url over 2048 chars", async () => {
    const wh = await createWebhook(generalId, "Val Hook 2");
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hi", avatar_url: "x".repeat(2049) }),
    });
    expect(res.status).toBe(400);
  });
});
