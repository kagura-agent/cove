import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { GatewayDispatcher } from "../ws/dispatcher.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos, type Repos } from "../repos/index.js";
import { createTaskOccurrence } from "../services/task-occurrence.js";
import type { Channel, Message, RecurringScheduleType, RecurringTask, Task, User } from "@cove/shared";

class RecordingDispatcher extends GatewayDispatcher {
  readonly events: string[] = [];

  constructor(repos: Repos) {
    super(repos.channels, repos.guilds);
  }

  override messageCreate(_message: Message): void { this.events.push("MESSAGE_CREATE"); }
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

  function template(
    scheduleType: RecurringScheduleType,
    intervalMs = 1_000,
    occurrenceMode: "same_task" | "new_task" = "new_task",
  ) {
    return repos.recurringTasks.create({
      guild_id: guildId,
      channel_id: channelId,
      title: "Recurring report",
      created_by: "creator",
      schedule_type: scheduleType,
      interval_ms: scheduleType === "interval" ? intervalMs : 0,
      occurrence_mode: occurrenceMode,
      heartbeat_interval_ms: 20_000,
    });
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

  it("creates a new task and thread after a new_task occurrence becomes terminal", async () => {
    const recurring = template("on_complete");
    const first = createInitialOccurrence(recurring);
    const recurringWorker = await worker();

    recurringWorker.tick();
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);

    repos.tasks.update(first.task_id, { status: "done" });
    recurringWorker.tick();
    const tasks = repos.tasks.listByChannel(channelId);
    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toMatchObject({ recurring_id: recurring.id, recurring_seq: 2, created_by: "creator", heartbeat_interval_ms: 20_000, status: "open" });
    expect(tasks[1].task_id).not.toBe(first.task_id);
    expect(tasks[1].thread_id).not.toBe(first.thread_id);
    expect(dispatcher.events).toEqual(["MESSAGE_CREATE", "THREAD_CREATE", "MESSAGE_CREATE", "TASK_CREATED"]);
    expect(repos.recurringTasks.getById(recurring.id)).toMatchObject({ last_task_id: tasks[1].task_id, last_spawned_at: expect.any(Number) });

    repos.tasks.update(tasks[1].task_id, { status: "cancelled" });
    recurringWorker.tick();
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(3);
  });

  it("reopens the same task and thread once an on_complete occurrence becomes terminal", async () => {
    const recurring = template("on_complete", 1_000, "same_task");
    const first = createInitialOccurrence(recurring);
    const recurringWorker = await worker();

    repos.tasks.update(first.task_id, { status: "done" });
    recurringWorker.tick();

    const tasks = repos.tasks.listByChannel(channelId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ task_id: first.task_id, thread_id: first.thread_id, status: "open" });
    expect(repos.recurringTasks.getById(recurring.id)).toMatchObject({ last_task_id: first.task_id });
    expect(dispatcher.events).toEqual(["TASK_UPDATED"]);

    recurringWorker.tick();
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);
  });

  it("waits for the full interval after same_task completion before reopening it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const recurring = template("interval", 10_000, "same_task");
    const first = createInitialOccurrence(recurring);
    const recurringWorker = await worker();

    vi.advanceTimersByTime(30_000);
    repos.tasks.update(first.task_id, { status: "done" });
    recurringWorker.tick();
    expect(repos.tasks.getById(first.task_id)).toMatchObject({ status: "done" });

    vi.advanceTimersByTime(9_999);
    recurringWorker.tick();
    expect(repos.tasks.getById(first.task_id)).toMatchObject({ status: "done" });

    vi.advanceTimersByTime(1);
    recurringWorker.tick();
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);
    expect(repos.tasks.getById(first.task_id)).toMatchObject({ task_id: first.task_id, thread_id: first.thread_id, status: "open" });
  });

  it("does nothing for disabled templates and leaves templates unchanged when their creator or parent channel is missing", async () => {
    const disabled = template("on_complete");
    const disabledTask = createInitialOccurrence(disabled);
    repos.tasks.update(disabledTask.task_id, { status: "done" });
    repos.recurringTasks.update(disabled.id, { enabled: false });
    (await worker()).tick();
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);
    expect(repos.tasks.getById(disabledTask.task_id)).toMatchObject({ status: "done" });

    const missingCreator = template("on_complete");
    db.prepare("UPDATE recurring_tasks SET created_by = ? WHERE id = ?").run("missing-creator", missingCreator.id);
    (await worker()).tick();
    expect(repos.recurringTasks.getById(missingCreator.id)).toMatchObject({ last_task_id: null, last_spawned_at: 0 });

    const missingChannel = template("on_complete");
    db.pragma("foreign_keys = OFF");
    db.prepare("UPDATE recurring_tasks SET channel_id = ? WHERE id = ?").run("missing-channel", missingChannel.id);
    db.pragma("foreign_keys = ON");
    (await worker()).tick();
    expect(repos.recurringTasks.getById(missingChannel.id)).toMatchObject({ last_task_id: null, last_spawned_at: 0 });
  });
});
