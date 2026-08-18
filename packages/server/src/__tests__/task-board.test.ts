import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import { createTaskOccurrence } from "../services/task-occurrence.js";
import type Database from "better-sqlite3";
import { API_PREFIX } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";

describe("Server-level task board (cross-channel aggregation)", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let guildId: string;
  let generalId: string;
  let secondChannelId: string;

  function authGet(path: string, token = adminToken) {
    return app.request(path, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
  }

  beforeEach(() => {
    db = initDb(":memory:");
    guildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, guildId);
    generalId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;
    secondChannelId = (db.prepare("SELECT id FROM channels WHERE name != 'general' ORDER BY position ASC LIMIT 1").get() as { id: string }).id;
    process.env.RATE_LIMIT_ENABLED = "false";
    app = createApp(db, createRepos(db), new GatewayDispatcher({ getById: () => null } as never));

    adminToken = "test-admin-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("admin", "Admin", null, 0, null, adminToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, "admin", null, "[]", now);
    db.prepare("UPDATE guilds SET owner_id = ? WHERE id = ?").run("admin", guildId);
  });

  afterEach(() => db.close());

  function createTaskIn(channelId: string, title: string, assigneeId?: string) {
    const repos = createRepos(db);
    const channel = repos.channels.getById(channelId)!;
    const creator = repos.users.getById("admin")!;
    const occurrence = repos.db.transaction(() =>
      createTaskOccurrence(repos, {
        channel,
        creator,
        title,
        ...(assigneeId ? { assigneeId } : {}),
      }),
    )();
    return occurrence.task;
  }

  it("returns tasks across all channels the caller can view", async () => {
    createTaskIn(generalId, "Task in general");
    createTaskIn(secondChannelId, "Task in second channel");

    const res = await authGet(`${API_PREFIX}/guilds/${guildId}/tasks`);
    expect(res.status).toBe(200);
    const tasks = await res.json();
    expect(tasks).toHaveLength(2);
    const titles = tasks.map((t: { title: string }) => t.title).sort();
    expect(titles).toEqual(["Task in general", "Task in second channel"]);
    const channels = new Set(tasks.map((t: { channel_id: string }) => t.channel_id));
    expect(channels).toEqual(new Set([generalId, secondChannelId]));
  });

  it("supports status filtering", async () => {
    const task = createTaskIn(generalId, "Open task");
    createTaskIn(secondChannelId, "Done task");

    // Mark second task done
    const repos = createRepos(db);
    repos.tasks.update(
      (db.prepare("SELECT task_id FROM tasks WHERE title = 'Done task'").get() as { task_id: string }).task_id,
      { status: "done" },
    );
    expect(task.status).toBe("open");

    const res = await authGet(`${API_PREFIX}/guilds/${guildId}/tasks?status=open`);
    const tasks = await res.json();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Open task");
  });

  it("supports assignee=me and assignee=none filters", async () => {
    const adminId = "admin";
    createTaskIn(generalId, "Mine", adminId);
    createTaskIn(secondChannelId, "Unassigned");

    const mineRes = await authGet(`${API_PREFIX}/guilds/${guildId}/tasks?assignee=me`);
    const mine = await mineRes.json();
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Mine");

    const unassignedRes = await authGet(`${API_PREFIX}/guilds/${guildId}/tasks?assignee=none`);
    const unassigned = await unassignedRes.json();
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].title).toBe("Unassigned");
  });

  it("supports channel filtering", async () => {
    createTaskIn(generalId, "Task in general");
    createTaskIn(secondChannelId, "Task in second channel");

    const res = await authGet(`${API_PREFIX}/guilds/${guildId}/tasks?channel=${generalId}`);
    const tasks = await res.json();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Task in general");
  });

  it("rejects callers who are not guild members", async () => {
    const res = await authGet(`${API_PREFIX}/guilds/${guildId}/tasks`);
    // admin is a member, so this should succeed; create a non-member token instead
    expect(res.status).toBe(200);

    const outsiderToken = "outsider-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("outsider", "Outsider", null, 0, null, outsiderToken, now, now);
    const outsiderRes = await authGet(`${API_PREFIX}/guilds/${guildId}/tasks`, outsiderToken);
    expect(outsiderRes.status).toBe(404);
  });

  it("excludes tasks from channels the caller cannot view", async () => {
    // Create a non-owner member (owners bypass all permission checks)
    const normalToken = "normal-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("normal", "Normal", null, 0, null, normalToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, "normal", null, "[]", now);

    // Create a third channel and deny VIEW_CHANNEL for the @everyone role
    const repos = createRepos(db);
    const third = repos.channels.create(guildId, "secret", undefined, 0);
    createTaskIn(generalId, "Visible task");
    createTaskIn(third.id, "Hidden task");

    // Deny VIEW_CHANNEL for @everyone on the secret channel (insert overwrite row)
    db.prepare("INSERT OR REPLACE INTO channel_permission_overwrites (channel_id, target_id, target_type, allow, deny) VALUES (?, ?, 0, '0', ?)")
      .run(third.id, guildId, (1n << 10n).toString());

    const res = await authGet(`${API_PREFIX}/guilds/${guildId}/tasks`, normalToken);
    const tasks = await res.json();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Visible task");
  });
});
