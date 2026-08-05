import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos, type Repos } from "../repos/index.js";

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

  it("creates the durable card, thread, task, assignment, heartbeat, and recurrence linkage", async () => {
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
    expect(db.prepare("SELECT channel_id, metadata FROM messages WHERE id = ?").get(occurrence.assignmentMessage.id)).toMatchObject({
      channel_id: occurrence.thread.id,
      metadata: expect.stringContaining("task_assignment"),
    });
  });
});
