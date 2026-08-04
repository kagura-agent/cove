import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { API_PREFIX, type Channel } from "@cove/shared";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos, type Repos } from "../repos/index.js";

describe("recurring task templates API", () => {
  let db: Database.Database;
  let repos: Repos;
  let app: ReturnType<typeof createApp>;
  let guildId: string;
  let channelId: string;
  const ownerToken = "recurring-owner-token";

  beforeEach(() => {
    process.env.RATE_LIMIT_ENABLED = "false";
    db = initDb(":memory:");
    guildId = (db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string }).id;
    seedChannels(db, guildId);
    channelId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("owner", "Owner", null, 1, ownerToken, now, now);
    db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, "owner", null, "[]", now);
    db.prepare("UPDATE guilds SET owner_id = ? WHERE id = ?").run("owner", guildId);
    repos = createRepos(db);
    app = createApp(db, repos);
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_ENABLED;
    db.close();
  });

  const headers = (token = ownerToken) => ({
    "Content-Type": "application/json",
    Authorization: `Bot ${token}`,
  });

  async function createTemplate(body: Record<string, unknown> = {}) {
    return app.request(`${API_PREFIX}/channels/${channelId}/recurring-tasks`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        title: "  Daily standup  ",
        schedule_type: "interval",
        interval_ms: 60_000,
        ...body,
      }),
    });
  }

  it("creates a trimmed interval template and lists it for the channel", async () => {
    const create = await createTemplate({ heartbeat_interval_ms: 15_000 });
    expect(create.status).toBe(201);
    const template = await create.json() as Record<string, unknown>;
    expect(template).toMatchObject({
      channel_id: channelId,
      guild_id: guildId,
      created_by: "owner",
      title: "Daily standup",
      schedule_type: "interval",
      interval_ms: 60_000,
      enabled: true,
      last_task_id: null,
    });

    const list = await app.request(`${API_PREFIX}/channels/${channelId}/recurring-tasks`, { headers: headers() });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([template]);
  });

  it("rejects blank titles, invalid schedules, and interval schedules without a positive interval", async () => {
    for (const body of [
      { title: "   " },
      { schedule_type: "cron", interval_ms: 60_000 },
      { schedule_type: "interval", interval_ms: 0 },
    ]) {
      const response = await createTemplate(body);
      expect(response.status).toBe(400);
    }
  });

  it("updates and deletes templates with the normal task permission rules", async () => {
    const created = await createTemplate();
    const template = await created.json() as { id: string };

    const update = await app.request(`${API_PREFIX}/recurring-tasks/${template.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ title: "  Follow up  ", schedule_type: "on_complete", enabled: false }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ title: "Follow up", schedule_type: "on_complete", enabled: false });

    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("member", "Member", null, 1, "member-token", now, now);
    db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, "member", null, "[]", now);
    const forbidden = await app.request(`${API_PREFIX}/recurring-tasks/${template.id}`, {
      method: "DELETE",
      headers: headers("member-token"),
    });
    expect(forbidden.status).toBe(403);

    const remove = await app.request(`${API_PREFIX}/recurring-tasks/${template.id}`, {
      method: "DELETE",
      headers: headers(),
    });
    expect(remove.status).toBe(200);
    expect(await remove.json()).toEqual({ deleted: true });
  });

  it("does not create templates inside a task thread", async () => {
    const task = await app.request(`${API_PREFIX}/channels/${channelId}/tasks`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title: "Task with a thread" }),
    });
    expect(task.status).toBe(201);
    const threadId = (await task.json() as { thread_id: string }).thread_id;
    const thread = repos.channels.getById(threadId) as Channel;
    expect(thread.type).toBe(11);

    const response = await app.request(`${API_PREFIX}/channels/${threadId}/recurring-tasks`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title: "Nested", schedule_type: "on_complete" }),
    });
    expect(response.status).toBe(400);
  });
});
