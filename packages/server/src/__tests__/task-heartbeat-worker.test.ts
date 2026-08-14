import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos, type Repos } from "../repos/index.js";
import { createTaskOccurrence } from "../services/task-occurrence.js";
import { TaskHeartbeatWorker } from "../workers/task-heartbeat.js";
import type { Message, Task } from "@cove/shared";

/** Minimal dispatcher double — records messageCreate calls, and simulates typing state. */
class FakeDispatcher {
  readonly sent: Message[] = [];
  typingActive = false;
  messageCreate(message: Message): void { this.sent.push(message); }
  hasActiveTyping(_channelId: string, _userId: string): boolean { return this.typingActive; }
}

describe("TaskHeartbeatWorker liveness + backlog coalescing", () => {
  let db: Database.Database;
  let repos: Repos;
  let dispatcher: FakeDispatcher;
  let guildId: string;
  let channelId: string;
  let task: Task;

  function createAssignedTask(heartbeatMs = 60_000): Task {
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("creator", "Creator", null, 1, now, now);
    db.prepare("INSERT INTO users (id, username, avatar, bot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("assignee", "Assignee", null, 1, now, now);
    db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, "creator", null, "[]", now);
    db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, "assignee", null, "[]", now);

    const occurrence = repos.db.transaction(() => createTaskOccurrence(repos, {
      channel: repos.channels.getById(channelId)!,
      creator: repos.users.getById("creator")!,
      title: "Heartbeat test",
      assigneeId: "assignee",
      heartbeatIntervalMs: heartbeatMs,
    }))();
    // Make it immediately due
    repos.tasks.update(occurrence.task.task_id, { heartbeat_last_at: 0 });
    // Backdate all thread messages so the assignment isn't counted as recent activity
    db.prepare("UPDATE messages SET timestamp = ? WHERE channel_id = ?").run(Date.now() - heartbeatMs - 1, occurrence.thread.id);
    return occurrence.task;
  }

  function heartbeatContent(taskId: string): string {
    return JSON.stringify({ content_type: "task_heartbeat", assignee_id: "assignee" });
  }

  function runTick(): void {
    const worker = new TaskHeartbeatWorker(repos, dispatcher as any) as unknown as { tick(): void };
    worker.tick();
  }

  beforeEach(() => {
    db = initDb(":memory:");
    guildId = (db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string }).id;
    seedChannels(db, guildId);
    channelId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;
    repos = createRepos(db);
    dispatcher = new FakeDispatcher();
  });

  afterEach(() => db.close());

  it("sends a heartbeat when the thread is silent and no active run exists", () => {
    task = createAssignedTask();
    runTick();
    expect(dispatcher.sent).toHaveLength(1);
    expect(dispatcher.sent[0].metadata).toBe(heartbeatContent(task.task_id));
  });

  it("does not send a heartbeat when a recent non-heartbeat message exists", () => {
    task = createAssignedTask();
    // Post an activity message after the heartbeat was due
    const recent = Date.now();
    db.prepare("INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("m-active", task.thread_id, "assignee", "Assignee", "working…", recent, null);
    runTick();
    expect(dispatcher.sent).toHaveLength(0);
  });

  it("does not send a heartbeat while an active agent run exists on the thread", () => {
    task = createAssignedTask();
    // Insert a real trigger message the run can reference (FK constraint)
    db.prepare("INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("m-trigger", task.thread_id, "assignee", "Assignee", "go", Date.now(), null);
    repos.agentRuns.start({
      agent_id: "assignee",
      channel_id: channelId,
      trigger_message_id: "m-trigger",
      thread_id: task.thread_id,
    });
    runTick();
    expect(dispatcher.sent).toHaveLength(0);
  });

  it("does not send a heartbeat while the assignee is actively typing", () => {
    task = createAssignedTask();
    dispatcher.typingActive = true;
    runTick();
    expect(dispatcher.sent).toHaveLength(0);
  });

  it("bumps heartbeat_last_at instead of stacking a second heartbeat when one is unanswered", () => {
    task = createAssignedTask();
    // First tick sends a heartbeat and bumps the timestamp
    runTick();
    expect(dispatcher.sent).toHaveLength(1);

    // Force it due again with no reply in between
    repos.tasks.update(task.task_id, { heartbeat_last_at: 0 });
    runTick();

    // No second heartbeat — the previous one is still unanswered
    expect(dispatcher.sent).toHaveLength(1);
    expect(repos.tasks.getById(task.task_id)!.heartbeat_last_at).toBeGreaterThan(0);
  });

  it("sends a fresh heartbeat after the agent replied to the previous one", () => {
    task = createAssignedTask();
    runTick();
    expect(dispatcher.sent).toHaveLength(1);

    // Agent replies with a normal message, then goes silent again
    db.prepare("INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("m-reply", task.thread_id, "assignee", "Assignee", "done", Date.now(), null);

    repos.tasks.update(task.task_id, { heartbeat_last_at: 0 });
    runTick();
    // The reply is still recent activity — no heartbeat while agent is engaged
    expect(dispatcher.sent).toHaveLength(1);

    // Now the reply ages out of the activity window and nothing else happened
    db.prepare("UPDATE messages SET timestamp = ? WHERE channel_id = ?").run(Date.now() - task.heartbeat_interval_ms - 1, task.thread_id);
    repos.tasks.update(task.task_id, { heartbeat_last_at: 0 });
    runTick();
    expect(dispatcher.sent).toHaveLength(2);
  });
});
