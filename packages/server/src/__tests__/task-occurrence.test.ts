import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos, type Repos } from "../repos/index.js";
import { TaskHeartbeatWorker } from "../workers/task-heartbeat.js";

describe("createTaskOccurrence", () => {
  let db: Database.Database;
  let repos: Repos;
  let guildId: string;
  let channelId: string;

  beforeEach(() => {
    db = initDb(":memory:");
    guildId = (db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string }).id;
    seedChannels(db, guildId);
    channelId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("creator", "Creator", null, 1, now, now);
    db.prepare("INSERT INTO users (id, username, avatar, bot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("assignee", "Assignee", null, 1, now, now);
    db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, "creator", null, "[]", now);
    db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, "assignee", null, "[]", now);
    repos = createRepos(db);
  });

  afterEach(() => db.close());

  it("creates assignment and heartbeat records only for an assigned task", async () => {
    const { createTaskOccurrence } = await import("../services/task-occurrence.js");
    const channel = repos.channels.getById(channelId)!;
    const creator = repos.users.getById("creator")!;

    const occurrence = repos.db.transaction(() => createTaskOccurrence(repos, {
      channel,
      creator,
      title: "Daily report",
      description: "Review overnight events",
      assigneeId: "assignee",
      heartbeatIntervalMs: 20_000,
      recurring: { id: "recurring-1", seq: 2 },
    }))();

    expect(occurrence.task).toMatchObject({
      channel_id: channelId,
      title: "Daily report",
      description: "Review overnight events",
      assignee_id: "assignee",
      recurring_id: "recurring-1",
      recurring_seq: 2,
      heartbeat_interval_ms: 20_000,
    });
    expect(occurrence.cardMessage.metadata).toContain("skip_agent_notify");
    expect(occurrence.thread).toMatchObject({ type: 11, parent_id: channelId });
    expect(repos.threads.isMember(occurrence.thread.id, "assignee")).toBe(true);
    expect(db.prepare("SELECT channel_id, metadata FROM messages WHERE id = ?").get(occurrence.assignmentMessage!.id)).toEqual({
      channel_id: occurrence.thread.id,
      metadata: JSON.stringify({ content_type: "task_assignment", assignee_id: "assignee" }),
    });
  });

  it("creates an unassigned task without an assignment message or heartbeat", async () => {
    const { createTaskOccurrence } = await import("../services/task-occurrence.js");
    const occurrence = repos.db.transaction(() => createTaskOccurrence(repos, {
      channel: repos.channels.getById(channelId)!,
      creator: repos.users.getById("creator")!,
      title: "Backlog task",
    }))();

    expect(occurrence.assignmentMessage).toBeUndefined();
    expect(occurrence.task).toMatchObject({ assignee_id: null, heartbeat_interval_ms: 0, heartbeat_last_at: 0 });
    expect(repos.threads.isMember(occurrence.thread.id, "assignee")).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE channel_id = ? AND metadata LIKE '%task_assignment%'").get(occurrence.thread.id)).toEqual({ count: 0 });
  });

  it("targets heartbeats to the assignee and excludes unassigned tasks", async () => {
    const { createTaskOccurrence } = await import("../services/task-occurrence.js");
    const channel = repos.channels.getById(channelId)!;
    const creator = repos.users.getById("creator")!;
    const assigned = repos.db.transaction(() => createTaskOccurrence(repos, { channel, creator, title: "Assigned", assigneeId: "assignee" }))();
    const unassigned = repos.db.transaction(() => createTaskOccurrence(repos, { channel, creator, title: "Unassigned" }))();
    repos.tasks.update(assigned.task.task_id, { heartbeat_last_at: 0 });
    repos.tasks.update(unassigned.task.task_id, { heartbeat_interval_ms: 1, heartbeat_last_at: 0 });
    db.prepare("UPDATE messages SET timestamp = ? WHERE channel_id = ?").run(Date.now() - assigned.task.heartbeat_interval_ms - 1, assigned.thread.id);

    const dispatcher = { messageCreate: vi.fn() };
    (new TaskHeartbeatWorker(repos, dispatcher as any) as unknown as { tick(): void }).tick();

    expect(dispatcher.messageCreate).toHaveBeenCalledTimes(1);
    expect(dispatcher.messageCreate).toHaveBeenCalledWith(expect.objectContaining({
      channel_id: assigned.thread.id,
      metadata: JSON.stringify({ content_type: "task_heartbeat", assignee_id: "assignee" }),
    }));
  });
});
