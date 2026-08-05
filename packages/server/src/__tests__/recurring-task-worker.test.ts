import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { GatewayDispatcher } from "../ws/dispatcher.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos, type Repos } from "../repos/index.js";
import { createTaskOccurrence } from "../services/task-occurrence.js";
import type { Channel, Message, RecurringTask, Task, User } from "@cove/shared";

class RecordingDispatcher extends GatewayDispatcher {
  readonly events: string[] = [];
  readonly messages: Message[] = [];

  constructor(repos: Repos) {
    super(repos.channels, repos.guilds);
  }

  override messageCreate(message: Message): void {
    this.events.push("MESSAGE_CREATE");
    this.messages.push(message);
  }
  override threadCreate(_thread: Channel): void { this.events.push("THREAD_CREATE"); }
  override taskCreated(_task: Task): void { this.events.push("TASK_CREATED"); }
  override taskUpdated(_task: Task): void { this.events.push("TASK_UPDATED"); }
}

describe("RecurringTaskWorker", () => {
  let db: Database.Database;
  let repos: Repos;
  let dispatcher: RecordingDispatcher;
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
    db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, "creator", null, "[]", now);
    repos = createRepos(db);
    dispatcher = new RecordingDispatcher(repos);
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  async function worker() {
    const module = await import("../workers/recurring-task.js").catch(() => null);
    expect(module).not.toBeNull();
    return new module!.RecurringTaskWorker(repos, dispatcher) as { tick(): void };
  }

  function template(intervalMs: number, occurrenceMode: "same_task" | "new_task") {
    return repos.recurringTasks.create({
      guild_id: guildId,
      channel_id: channelId,
      title: "Recurring report",
      created_by: "creator",
      interval_ms: intervalMs,
      occurrence_mode: occurrenceMode,
      heartbeat_interval_ms: 20_000,
    });
  }

  function nextRunAt(recurringId: string): number {
    return (db.prepare("SELECT next_run_at FROM recurring_tasks WHERE id = ?").get(recurringId) as { next_run_at: number }).next_run_at;
  }

  function createInitialOccurrence(recurring: RecurringTask): Task {
    const channel = repos.channels.getById(channelId) as Channel;
    const creator = repos.users.getById("creator") as User;
    return repos.db.transaction(() => {
      const occurrence = createTaskOccurrence(repos, {
        channel,
        creator,
        title: recurring.title,
        description: recurring.description,
        assigneeId: recurring.assignee_id,
        heartbeatIntervalMs: recurring.heartbeat_interval_ms,
        recurring: { id: recurring.id, seq: 1 },
      });
      repos.recurringTasks.update(recurring.id, {
        last_task_id: occurrence.task.task_id,
        last_spawned_at: Date.now(),
      });
      return occurrence.task;
    })();
  }

  it("reassigns an in-review same-task occurrence in its existing thread", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const day = 24 * 60 * 60 * 1_000;
    const recurring = template(day, "same_task");
    const firstDue = nextRunAt(recurring.id);
    const first = createInitialOccurrence(recurring);
    const threadCount = (db.prepare("SELECT COUNT(*) AS count FROM channels WHERE parent_id = ?").get(channelId) as { count: number }).count;
    const assignmentCount = (db.prepare("SELECT COUNT(*) AS count FROM messages WHERE channel_id = ? AND metadata LIKE '%task_assignment%'").get(first.thread_id) as { count: number }).count;
    const initialAssignment = db.prepare("SELECT content FROM messages WHERE channel_id = ? AND metadata LIKE '%task_assignment%'").get(first.thread_id) as { content: string };
    repos.tasks.update(first.task_id, { status: "in_review" });

    vi.advanceTimersByTime(day);
    (await worker()).tick();

    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);
    expect(repos.tasks.getById(first.task_id)).toMatchObject({ task_id: first.task_id, thread_id: first.thread_id, status: "open" });
    expect((db.prepare("SELECT COUNT(*) AS count FROM channels WHERE parent_id = ?").get(channelId) as { count: number }).count).toBe(threadCount);
    expect((db.prepare("SELECT COUNT(*) AS count FROM messages WHERE channel_id = ? AND metadata LIKE '%task_assignment%'").get(first.thread_id) as { count: number }).count).toBe(assignmentCount + 1);
    expect(db.prepare("SELECT content, metadata FROM messages WHERE channel_id = ? AND metadata LIKE '%task_assignment%' ORDER BY timestamp DESC, id DESC LIMIT 1").get(first.thread_id)).toEqual({
      content: initialAssignment.content,
      metadata: JSON.stringify({ content_type: "task_assignment" }),
    });
    expect(dispatcher.events).toEqual(["MESSAGE_CREATE"]);
    expect(dispatcher.messages[0]).toMatchObject({
      channel_id: first.thread_id,
      content: initialAssignment.content,
      metadata: expect.stringContaining("task_assignment"),
    });
    expect(nextRunAt(recurring.id)).toBe(firstDue + day);
  });

  it("reassigns a completed same-task occurrence in its existing thread", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const day = 24 * 60 * 60 * 1_000;
    const recurring = template(day, "same_task");
    const firstDue = nextRunAt(recurring.id);
    const first = createInitialOccurrence(recurring);
    repos.tasks.update(first.task_id, { status: "done" });

    vi.advanceTimersByTime(day);
    (await worker()).tick();

    expect(repos.recurringTasks.getById(recurring.id)).toMatchObject({ enabled: true, next_run_at: firstDue + day });
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);
    expect(repos.tasks.getById(first.task_id)).toMatchObject({ thread_id: first.thread_id, status: "open" });
    expect(dispatcher.events).toEqual(["MESSAGE_CREATE"]);
    expect(dispatcher.messages[0]).toMatchObject({ channel_id: first.thread_id, metadata: expect.stringContaining("task_assignment") });
  });

  it("creates a new task for a completed new-task occurrence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const day = 24 * 60 * 60 * 1_000;
    const recurring = template(day, "new_task");
    const firstDue = nextRunAt(recurring.id);
    const first = createInitialOccurrence(recurring);
    repos.tasks.update(first.task_id, { status: "done" });

    vi.advanceTimersByTime(day);
    (await worker()).tick();

    const tasks = repos.tasks.listByChannel(channelId);
    expect(repos.recurringTasks.getById(recurring.id)).toMatchObject({ enabled: true, next_run_at: firstDue + day, last_task_id: tasks[1].task_id });
    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toMatchObject({ recurring_id: recurring.id, recurring_seq: 2, status: "open" });
    expect(tasks[1].thread_id).not.toBe(first.thread_id);
    expect(dispatcher.events).toEqual(["MESSAGE_CREATE", "THREAD_CREATE", "MESSAGE_CREATE", "TASK_CREATED"]);
  });

  it.each(["same_task", "new_task"] as const)("stops a %s recurrence when its prior occurrence is cancelled", async (occurrenceMode) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const day = 24 * 60 * 60 * 1_000;
    const recurring = template(day, occurrenceMode);
    const first = createInitialOccurrence(recurring);
    const taskCount = repos.tasks.listByChannel(channelId).length;
    const threadCount = (db.prepare("SELECT COUNT(*) AS count FROM channels WHERE parent_id = ?").get(channelId) as { count: number }).count;
    const messageCount = (db.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count;
    repos.tasks.update(first.task_id, { status: "cancelled" });

    vi.advanceTimersByTime(day);
    (await worker()).tick();

    expect(repos.recurringTasks.getById(recurring.id)).toMatchObject({ enabled: false, next_run_at: 0 });
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(taskCount);
    expect(repos.tasks.getById(first.task_id)).toMatchObject({ thread_id: first.thread_id, status: "cancelled" });
    expect((db.prepare("SELECT COUNT(*) AS count FROM channels WHERE parent_id = ?").get(channelId) as { count: number }).count).toBe(threadCount);
    expect((db.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count).toBe(messageCount);
    expect(dispatcher.events).toEqual([]);
  });

  it.each(["open", "in_progress"] as const)("skips a due same_task occurrence while the prior task is %s", async (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const day = 24 * 60 * 60 * 1_000;
    const recurring = template(day, "same_task");
    const firstDue = nextRunAt(recurring.id);
    const first = createInitialOccurrence(recurring);
    repos.tasks.update(first.task_id, { status });

    vi.advanceTimersByTime(day);
    (await worker()).tick();

    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);
    expect(repos.tasks.getById(first.task_id)).toMatchObject({ status });
    expect(dispatcher.events).toEqual([]);
    expect(nextRunAt(recurring.id)).toBe(firstDue + day);
  });

  it("creates one task for a delayed due time and skips missed intervals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const everyTwoDays = 2 * 24 * 60 * 60 * 1_000;
    const recurring = template(everyTwoDays, "new_task");
    const firstDue = nextRunAt(recurring.id);
    const first = createInitialOccurrence(recurring);
    repos.tasks.update(first.task_id, { status: "in_review" });

    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1_000);
    (await worker()).tick();

    const tasks = repos.tasks.listByChannel(channelId);
    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toMatchObject({ recurring_id: recurring.id, recurring_seq: 2, status: "open" });
    expect(tasks[1].task_id).not.toBe(first.task_id);
    expect(tasks[1].thread_id).not.toBe(first.thread_id);
    expect(nextRunAt(recurring.id)).toBe(firstDue + 3 * everyTwoDays);
  });

  it.each(["open", "in_progress"] as const)("skips a due new_task occurrence while the prior occurrence is %s", async (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const day = 24 * 60 * 60 * 1_000;
    const recurring = template(day, "new_task");
    const firstDue = nextRunAt(recurring.id);
    const first = createInitialOccurrence(recurring);
    const threadCount = (db.prepare("SELECT COUNT(*) AS count FROM channels WHERE parent_id = ?").get(channelId) as { count: number }).count;
    repos.tasks.update(first.task_id, { status });

    vi.advanceTimersByTime(day);
    (await worker()).tick();

    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);
    expect((db.prepare("SELECT COUNT(*) AS count FROM channels WHERE parent_id = ?").get(channelId) as { count: number }).count).toBe(threadCount);
    expect(repos.tasks.getById(first.task_id)).toMatchObject({ status });
    expect(nextRunAt(recurring.id)).toBe(firstDue + day);
    expect(dispatcher.events).toEqual([]);
  });

  it("does not run templates without a persisted next run time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const recurring = template(10_000, "new_task");
    const first = createInitialOccurrence(recurring);
    repos.tasks.update(first.task_id, { status: "done" });
    db.prepare("UPDATE recurring_tasks SET next_run_at = 0 WHERE id = ?").run(recurring.id);

    vi.advanceTimersByTime(10_000);
    (await worker()).tick();

    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);
    expect(nextRunAt(recurring.id)).toBe(0);
  });
});
