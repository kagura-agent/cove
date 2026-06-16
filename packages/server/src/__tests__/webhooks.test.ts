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
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello from webhook" }),
    });
    expect(res.status).toBe(200);
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
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "custom", username: "Custom Bot" }),
    });
    expect(res.status).toBe(200);
    const msg: Message = await res.json();
    expect(msg.author.username).toBe("Custom Bot");
  });

  it("execute without ?wait returns 204 with no body", async () => {
    const wh = await createWebhook(generalId, "No Wait Hook");
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "default behavior" }),
    });
    expect(res.status).toBe(204);
    const body = await res.text();
    expect(body).toBe("");
  });

  it("execute with ?wait=true returns 200 with message", async () => {
    const wh = await createWebhook(generalId, "Wait Hook");
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "with wait param" }),
    });
    expect(res.status).toBe(200);
    const msg: Message = await res.json();
    expect(msg.content).toBe("with wait param");
    expect(msg.webhook_id).toBe(wh.id);
  });

  it("execute with ?thread_id routes message to thread", async () => {
    const wh = await createWebhook(generalId, "Thread Hook");

    // Create a thread first
    const msgRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "thread parent" }),
    });
    const parentMsg: Message = await msgRes.json();

    const threadRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages/${parentMsg.id}/threads`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "test thread" }),
    });
    const thread = await threadRes.json() as { id: string };

    // Execute webhook with thread_id
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}?wait=true&thread_id=${thread.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "message in thread" }),
    });
    expect(res.status).toBe(200);
    const msg: Message = await res.json();
    expect(msg.channel_id).toBe(thread.id);
    expect(msg.content).toBe("message in thread");
  });

  it("execute with invalid thread_id returns 404", async () => {
    const wh = await createWebhook(generalId, "Bad Thread Hook");
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}?thread_id=invalid-thread-id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "should fail" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe(10003);
  });

  it("execute with archived thread returns 403", async () => {
    const wh = await createWebhook(generalId, "Archived Thread Hook");

    // Create a thread
    const msgRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "archived parent" }),
    });
    const parentMsg: Message = await msgRes.json();

    const threadRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages/${parentMsg.id}/threads`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "archived thread" }),
    });
    const thread = await threadRes.json() as { id: string };

    // Archive the thread
    await app.request(`${API_PREFIX}/channels/${thread.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ archived: true }),
    });

    // Try to execute webhook with archived thread
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}?thread_id=${thread.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "should fail" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(50083);
    expect(body.message).toBe("This thread is archived");
  });

  it("execute with locked thread returns 403", async () => {
    const wh = await createWebhook(generalId, "Locked Thread Hook");

    // Create a thread
    const msgRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "locked parent" }),
    });
    const parentMsg: Message = await msgRes.json();

    const threadRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages/${parentMsg.id}/threads`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "locked thread" }),
    });
    const thread = await threadRes.json() as { id: string };

    // Lock the thread
    await app.request(`${API_PREFIX}/channels/${thread.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ locked: true }),
    });

    // Try to execute webhook with locked thread
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/${wh.token}?thread_id=${thread.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "should fail" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(50083);
    expect(body.message).toBe("This thread is locked");
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

  // ─── Negative auth tests ───────────────────────────────────────────

  it("unauthenticated request returns 401", async () => {
    const res = await app.request(`${API_PREFIX}/channels/${generalId}/webhooks`);
    expect(res.status).toBe(401);
  });

  it("non-member user gets 404 (Unknown Channel)", async () => {
    const now = Date.now();
    const outsiderToken = "outsider-token";
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("outsider", "Outsider", null, 0, null, outsiderToken, now, now);

    const res = await app.request(`${API_PREFIX}/channels/${generalId}/webhooks`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe(10003);
  });

  it("wrong webhook token on execute returns 404", async () => {
    const wh = await createWebhook(generalId, "Token Test");
    const res = await app.request(`${API_PREFIX}/webhooks/${wh.id}/wrong-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("cross-guild user cannot manage webhooks in another guild", async () => {
    const now = Date.now();
    const otherGuildId = "other-guild-id";
    db.prepare("INSERT INTO guilds (id, name, icon, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(otherGuildId, "Other Guild", null, null, now, now);

    const crossToken = "cross-guild-token";
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("cross-user", "CrossUser", null, 1, null, crossToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(otherGuildId, "cross-user", null, "[]", now);

    const res = await app.request(`${API_PREFIX}/channels/${generalId}/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${crossToken}`,
      },
      body: JSON.stringify({ name: "Sneaky Hook" }),
    });
    expect(res.status).toBe(404);
  });

  it("deleted webhook messages retain sender_name as author", async () => {
    // Create webhook
    const createRes = await app.request(`${API_PREFIX}/channels/${generalId}/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: "Temp Hook" }),
    });
    const webhook = (await createRes.json()) as { id: string; token: string };

    // Send a message via webhook
    const execRes = await app.request(`${API_PREFIX}/webhooks/${webhook.id}/${webhook.token}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "before delete", username: "Custom Name" }),
    });
    expect(execRes.status).toBe(200);
    const msg = (await execRes.json()) as { id: string };

    // Delete the webhook
    const delRes = await app.request(`${API_PREFIX}/webhooks/${webhook.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${adminToken}` },
    });
    expect(delRes.status).toBe(204);

    // Fetch messages — the deleted webhook message should retain sender_name
    const listRes = await app.request(`${API_PREFIX}/channels/${generalId}/messages?limit=50`, {
      headers: { Authorization: `Bot ${adminToken}` },
    });
    const messages = (await listRes.json()) as Array<{ id: string; author: { username: string; bot: boolean } }>;
    const found = messages.find((m) => m.id === msg.id);
    expect(found).toBeDefined();
    expect(found!.author.username).toBe("Custom Name");
    expect(found!.author.bot).toBe(true);
  });
});
