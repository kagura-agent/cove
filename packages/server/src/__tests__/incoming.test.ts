import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import type { Message } from "@cove/shared";
import { API_PREFIX } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";
import { WebhookType } from "../repos/webhooks.js";

describe("Incoming Messages (Cross-channel)", () => {
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

    const repos = createRepos(db);
    app = createApp(db, repos, new TestDispatcher());

    adminToken = "test-admin-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("admin", "Admin", null, 0, null, adminToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "admin", null, "[]", now);
    db.prepare("UPDATE guilds SET owner_id = ? WHERE id = ?").run("admin", defaultGuildId);
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_ENABLED;
  });

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken}`,
  });

  it("POST /channels/:id/incoming succeeds", async () => {
    const res = await app.request(`${API_PREFIX}/channels/${generalId}/incoming`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "Hello from another channel" }),
    });
    expect(res.status).toBe(200);
    const msg = (await res.json()) as Message;
    expect(msg.content).toBe("Hello from another channel");
    expect(msg.webhook_id).toBeTruthy();
    expect(broadcastEvents.length).toBe(1);
  });

  it("returns 403 without SEND_MESSAGES permission", async () => {
    const noPermToken = "no-perm-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("noperm", "NoPerm", null, 0, null, noPermToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "noperm", null, "[]", now);

    // Deny SEND_MESSAGES via permission overwrite
    const repos = createRepos(db);
    const everyoneRoleId = defaultGuildId;
    repos.permissions.upsert(generalId, everyoneRoleId, 0, "0", "2048");

    const res = await app.request(`${API_PREFIX}/channels/${generalId}/incoming`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${noPermToken}` },
      body: JSON.stringify({ content: "Should fail" }),
    });
    expect(res.status).toBe(403);
  });

  it("auto-creates internal webhook for channel without one", async () => {
    // Remove any existing internal webhooks for generalId
    db.prepare("DELETE FROM webhooks WHERE channel_id = ? AND type = 2").run(generalId);

    const res = await app.request(`${API_PREFIX}/channels/${generalId}/incoming`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "Auto-create test" }),
    });
    expect(res.status).toBe(200);

    // Verify internal webhook was created
    const row = db.prepare("SELECT * FROM webhooks WHERE channel_id = ? AND type = 2").get(generalId);
    expect(row).toBeTruthy();
  });

  it("internal webhook not in list API", async () => {
    const res = await app.request(`${API_PREFIX}/channels/${generalId}/webhooks`, {
      method: "GET",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const webhooks = (await res.json()) as any[];
    for (const wh of webhooks) {
      expect(wh.type).not.toBe(WebhookType.INTERNAL);
    }
  });

  it("internal webhook cannot be deleted (403)", async () => {
    // Get the internal webhook
    const row = db.prepare("SELECT id FROM webhooks WHERE channel_id = ? AND type = 2").get(generalId) as { id: string } | undefined;
    if (!row) {
      // Create one
      const repos = createRepos(db);
      repos.webhooks.createInternal(generalId, defaultGuildId);
    }
    const internal = db.prepare("SELECT id FROM webhooks WHERE channel_id = ? AND type = 2").get(generalId) as { id: string };

    const res = await app.request(`${API_PREFIX}/webhooks/${internal.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect((body as any).code).toBe(50013);
  });

  it("internal webhook cannot be patched (403)", async () => {
    let row = db.prepare("SELECT id FROM webhooks WHERE channel_id = ? AND type = 2").get(generalId) as { id: string } | undefined;
    if (!row) {
      const repos = createRepos(db);
      repos.webhooks.createInternal(generalId, defaultGuildId);
      row = db.prepare("SELECT id FROM webhooks WHERE channel_id = ? AND type = 2").get(generalId) as { id: string };
    }

    const res = await app.request(`${API_PREFIX}/webhooks/${row.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Hacked" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect((body as any).code).toBe(50013);
  });

  it("thread_id routing works", async () => {
    // Create a thread under general
    const repos = createRepos(db);
    const thread = repos.threads.createStandalone(defaultGuildId, generalId, "Test Thread", "admin");

    const res = await app.request(`${API_PREFIX}/channels/${generalId}/incoming`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "Thread message", thread_id: thread.id }),
    });
    expect(res.status).toBe(200);
    const msg = (await res.json()) as Message;
    expect(msg.channel_id).toBe(thread.id);
  });
});
