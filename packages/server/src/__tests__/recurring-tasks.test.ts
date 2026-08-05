import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    vi.useRealTimers();
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
        interval_ms: 60_000,
        ...body,
      }),
    });
  }

  it("creates an immediate calendar template with the first due time after its interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));

    const create = await createTemplate({ heartbeat_interval_ms: 15_000 });
    expect(create.status).toBe(201);
    const template = await create.json() as Record<string, unknown>;
    expect(template).toMatchObject({
      channel_id: channelId,
      guild_id: guildId,
      created_by: "owner",
      title: "Daily standup",
      interval_ms: 60_000,
      occurrence_mode: "same_task",
      next_run_at: new Date("2026-08-04T12:01:00.000Z").getTime(),
      enabled: true,
      last_task_id: expect.any(String),
    });
    const initialTask = repos.tasks.getById(template.last_task_id as string);
    expect(initialTask).toMatchObject({
      channel_id: channelId,
      recurring_id: template.id,
      recurring_seq: 1,
      title: "Daily standup",
      status: "open",
    });

    const list = await app.request(`${API_PREFIX}/channels/${channelId}/recurring-tasks`, { headers: headers() });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([template]);
  });

  it("rejects missing or non-positive calendar intervals and invalid occurrence modes", async () => {
    for (const body of [
      { title: "   " },
      { interval_ms: undefined },
      { interval_ms: 0 },
      { occurrence_mode: "replace_task" },
    ]) {
      const response = await createTemplate(body);
      expect(response.status).toBe(400);
    }
  });

  it("re-anchors the next run when updating a template interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const created = await createTemplate();
    const template = await created.json() as { id: string; next_run_at: number };

    vi.setSystemTime(new Date("2026-08-04T12:00:30.000Z"));
    const update = await app.request(`${API_PREFIX}/recurring-tasks/${template.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ interval_ms: 120_000 }),
    });

    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      interval_ms: 120_000,
      next_run_at: new Date("2026-08-04T12:02:30.000Z").getTime(),
    });
  });

  it("preserves the next run when an update resends the unchanged interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const created = await createTemplate();
    const template = await created.json() as { id: string; next_run_at: number };

    vi.setSystemTime(new Date("2026-08-04T12:00:30.000Z"));
    const update = await app.request(`${API_PREFIX}/recurring-tasks/${template.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ interval_ms: 60_000, title: "Follow up", enabled: false }),
    });

    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      title: "Follow up",
      interval_ms: 60_000,
      enabled: false,
      next_run_at: template.next_run_at,
    });
  });

  it("preserves the next run when updating a template without an interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const created = await createTemplate();
    const template = await created.json() as { id: string; next_run_at: number };

    vi.setSystemTime(new Date("2026-08-04T12:00:30.000Z"));
    const update = await app.request(`${API_PREFIX}/recurring-tasks/${template.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ title: "  Follow up  ", occurrence_mode: "new_task", enabled: false }),
    });

    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      title: "Follow up",
      occurrence_mode: "new_task",
      enabled: false,
      next_run_at: template.next_run_at,
    });
  });

  it("deletes templates with the normal task permission rules", async () => {
    const created = await createTemplate();
    const template = await created.json() as { id: string };

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

  it("deletes a template and clears recurrence associations from every occurrence", async () => {
    const created = await createTemplate();
    const template = await created.json() as { id: string; last_task_id: string };
    const firstOccurrence = repos.tasks.getById(template.last_task_id)!;
    const secondCreate = await app.request(`${API_PREFIX}/channels/${channelId}/tasks`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title: "Follow-up occurrence", description: "Keep this description" }),
    });
    const secondOccurrence = await secondCreate.json() as { task_id: string; thread_id: string };
    db.prepare("UPDATE tasks SET recurring_id = ?, recurring_seq = ? WHERE task_id = ?").run(template.id, 2, secondOccurrence.task_id);
    repos.tasks.update(secondOccurrence.task_id, { status: "in_progress" });

    const remove = await app.request(`${API_PREFIX}/recurring-tasks/${template.id}`, {
      method: "DELETE",
      headers: headers(),
    });

    expect(remove.status).toBe(200);
    expect(repos.recurringTasks.getById(template.id)).toBeNull();
    expect(repos.tasks.getById(firstOccurrence.task_id)).toMatchObject({
      task_id: firstOccurrence.task_id,
      title: firstOccurrence.title,
      status: firstOccurrence.status,
      thread_id: firstOccurrence.thread_id,
      recurring_id: null,
      recurring_seq: 0,
    });
    expect(repos.tasks.getById(secondOccurrence.task_id)).toMatchObject({
      task_id: secondOccurrence.task_id,
      title: "Follow-up occurrence",
      description: "Keep this description",
      status: "in_progress",
      thread_id: secondOccurrence.thread_id,
      recurring_id: null,
      recurring_seq: 0,
    });
  });

  it("separates thread membership from assignment and heartbeat execution", async () => {
    const now = Date.now();
    for (const [id, token] of [["assignee-a", "assignee-a-token"], ["assignee-b", "assignee-b-token"]]) {
      db.prepare("INSERT INTO users (id, username, avatar, bot, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, id, null, 1, token, now, now);
      db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
        .run(guildId, id, null, "[]", now);
    }

    const initiallyAssigned = await app.request(`${API_PREFIX}/channels/${channelId}/tasks`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title: "Assigned immediately", assignee_id: "assignee-a" }),
    });
    const initialTask = await initiallyAssigned.json() as { thread_id: string; heartbeat_interval_ms: number };
    expect(initialTask.heartbeat_interval_ms).toBe(300_000);
    expect(db.prepare("SELECT metadata FROM messages WHERE channel_id = ? AND metadata LIKE '%task_assignment%'").get(initialTask.thread_id)).toEqual({
      metadata: JSON.stringify({ content_type: "task_assignment", assignee_id: "assignee-a" }),
    });

    const created = await app.request(`${API_PREFIX}/channels/${channelId}/tasks`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title: "Unassigned backlog" }),
    });
    const task = await created.json() as { task_id: string; thread_id: string; heartbeat_interval_ms: number; heartbeat_last_at: number };
    expect(task).toMatchObject({ heartbeat_interval_ms: 0, heartbeat_last_at: 0 });
    expect(repos.threads.isMember(task.thread_id, "assignee-a")).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE channel_id = ? AND metadata LIKE '%task_assignment%'").get(task.thread_id)).toEqual({ count: 0 });

    const assigned = await app.request(`${API_PREFIX}/tasks/${task.task_id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ assignee_id: "assignee-a" }),
    });
    expect(await assigned.json()).toMatchObject({ assignee_id: "assignee-a", heartbeat_interval_ms: 300_000 });
    expect(repos.threads.isMember(task.thread_id, "assignee-a")).toBe(true);
    expect(db.prepare("SELECT metadata FROM messages WHERE channel_id = ? AND metadata LIKE '%task_assignment%' ORDER BY timestamp DESC, id DESC LIMIT 1").get(task.thread_id)).toEqual({
      metadata: JSON.stringify({ content_type: "task_assignment", assignee_id: "assignee-a" }),
    });

    const reassigned = await app.request(`${API_PREFIX}/tasks/${task.task_id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ assignee_id: "assignee-b" }),
    });
    expect(await reassigned.json()).toMatchObject({ assignee_id: "assignee-b", heartbeat_interval_ms: 300_000 });
    expect(repos.threads.isMember(task.thread_id, "assignee-b")).toBe(true);
    expect(db.prepare("SELECT metadata FROM messages WHERE channel_id = ? AND metadata LIKE '%task_assignment%' ORDER BY timestamp DESC, id DESC LIMIT 1").get(task.thread_id)).toEqual({
      metadata: JSON.stringify({ content_type: "task_assignment", assignee_id: "assignee-b" }),
    });

    const unassigned = await app.request(`${API_PREFIX}/tasks/${task.task_id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ assignee_id: null }),
    });
    expect(await unassigned.json()).toMatchObject({ assignee_id: null, heartbeat_interval_ms: 0, heartbeat_last_at: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE channel_id = ? AND metadata LIKE '%task_assignment%'").get(task.thread_id)).toEqual({ count: 2 });
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
      body: JSON.stringify({ title: "Nested", interval_ms: 60_000 }),
    });
    expect(response.status).toBe(400);
  });
});
