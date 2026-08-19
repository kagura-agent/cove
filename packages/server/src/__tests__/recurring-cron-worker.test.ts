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

describe("RecurringTaskWorker — cron schedules (#533)", () => {
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
    db.prepare("INSERT INTO users (id, username, avatar, bot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("assignee", "Assignee", null, 1, now, now);
    db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, "assignee", null, "[]", now);
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

  function cronTemplate(expr: string, overrides: Partial<Parameters<typeof repos.recurringTasks.create>[0]> = {}) {
    return repos.recurringTasks.create({
      guild_id: guildId,
      channel_id: channelId,
      title: "Cron report",
      created_by: "creator",
      assignee_id: "assignee",
      interval_ms: 0,
      cron_expr: expr,
      cron_tz: "Asia/Shanghai",
      catch_up: "skip",
      occurrence_mode: "new_task",
      heartbeat_interval_ms: 20_000,
      ...overrides,
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

  it("sets next_run_at to the next fire time in the configured timezone (not interval addition)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:50:00.000Z")); // 17:50 Asia/Shanghai
    const recurring = cronTemplate("0 9 * * *"); // 09:00 Asia/Shanghai = 01:00 UTC
    // 2026-08-20T01:00:00Z = 2026-08-20T09:00:00+08:00
    expect(nextRunAt(recurring.id)).toBe(Date.parse("2026-08-20T01:00:00.000Z"));
  });

  it("spawns a new task at the cron fire time and advances to the next fire", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:50:00.000Z")); // 17:50 Asia/Shanghai
    const recurring = cronTemplate("15,45 8-22 * * *"); // study-loop style
    const firstDue = nextRunAt(recurring.id);
    expect(firstDue).toBe(Date.parse("2026-08-19T10:15:00.000Z")); // 18:15 Asia/Shanghai
    const first = createInitialOccurrence(recurring);
    repos.tasks.update(first.task_id, { status: "done" });

    vi.setSystemTime(new Date("2026-08-19T10:15:00.100Z")); // just after fire
    (await worker()).tick();

    const tasks = repos.tasks.listByChannel(channelId);
    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toMatchObject({ recurring_id: recurring.id, recurring_seq: 2, status: "open" });
    expect(nextRunAt(recurring.id)).toBe(Date.parse("2026-08-19T10:45:00.000Z")); // 18:45 Asia/Shanghai
  });

  it("with catch_up=skip skips missed fires during downtime and lands on the next fire", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:50:00.000Z"));
    const recurring = cronTemplate("0 9 * * *", { catch_up: "skip" });
    const firstDue = nextRunAt(recurring.id); // 2026-08-20T01:00:00Z
    const first = createInitialOccurrence(recurring);
    repos.tasks.update(first.task_id, { status: "done" });

    // Downtime: server is down for 3 days, comes back 2026-08-22T02:00:00Z (after 2 missed 09:00 fires)
    vi.setSystemTime(new Date("2026-08-22T02:00:00.000Z"));
    (await worker()).tick();

    // Exactly one backfill — the most recent fire — not a burst of missed runs.
    const tasks = repos.tasks.listByChannel(channelId);
    expect(tasks).toHaveLength(2);
    expect(tasks[1].status).toBe("open");
    expect(nextRunAt(recurring.id)).toBe(Date.parse("2026-08-23T01:00:00.000Z")); // next 09:00 Asia/Shanghai
  });

  it("with catch_up=run backfills one task per missed fire until caught up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:50:00.000Z"));
    const recurring = cronTemplate("0 0 * * *", { catch_up: "run", occurrence_mode: "new_task" }); // every midnight Asia/Shanghai
    const firstDue = nextRunAt(recurring.id); // 2026-08-19T16:00:00Z
    const first = createInitialOccurrence(recurring);
    repos.tasks.update(first.task_id, { status: "done" });

    // Downtime over two midnights (08-19T16:00Z and 08-20T16:00Z), back at 00:30 Asia/Shanghai on 08-21.
    vi.setSystemTime(new Date("2026-08-20T16:30:00.000Z"));
    const w = await worker();
    w.tick();

    // First tick spawns the oldest missed fire; next_run_at still points at the second missed fire.
    let tasks = repos.tasks.listByChannel(channelId);
    expect(tasks).toHaveLength(2);
    expect(nextRunAt(recurring.id)).toBe(Date.parse("2026-08-20T16:00:00.000Z"));
    expect(nextRunAt(recurring.id)).toBeLessThanOrEqual(Date.now());

    // Overlap guard: while the backfilled task is still open, the next tick
    // keeps next_run_at at the missed fire (no advance) so the run is
    // backfilled once the task completes.
    w.tick();
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(2);
    expect(nextRunAt(recurring.id)).toBe(Date.parse("2026-08-20T16:00:00.000Z"));

    // Complete the backfilled task → next tick backfills the remaining missed fire.
    repos.tasks.update(tasks[1].task_id, { status: "done" });
    vi.setSystemTime(new Date("2026-08-20T16:31:00.000Z"));
    w.tick();
    tasks = repos.tasks.listByChannel(channelId);
    expect(tasks).toHaveLength(3);
    expect(nextRunAt(recurring.id)).toBe(Date.parse("2026-08-21T16:00:00.000Z")); // next midnight Asia/Shanghai
  });

  it("with catch_up=run spawns at most one task per tick for a single missed fire", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:50:00.000Z"));
    const recurring = cronTemplate("30 9 * * *", { catch_up: "run" }); // 09:30 Asia/Shanghai
    const first = createInitialOccurrence(recurring);
    repos.tasks.update(first.task_id, { status: "done" });

    // One fire missed (09:30 today), now 09:31 Asia/Shanghai on 08-20.
    vi.setSystemTime(new Date("2026-08-20T01:31:00.000Z"));
    const w = await worker();
    w.tick();
    w.tick();

    const tasks = repos.tasks.listByChannel(channelId);
    expect(tasks).toHaveLength(2);
    expect(nextRunAt(recurring.id)).toBe(Date.parse("2026-08-21T01:30:00.000Z")); // tomorrow 09:30
  });

  it("does not spawn a cron template before its first fire time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:50:00.000Z"));
    const recurring = cronTemplate("0 9 * * *");
    const first = createInitialOccurrence(recurring);
    repos.tasks.update(first.task_id, { status: "done" });

    // Before fire time (17:50 Asia/Shanghai; fire is tomorrow 09:00)
    (await worker()).tick();

    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);
    expect(dispatcher.events).toEqual([]);
    expect(nextRunAt(recurring.id)).toBe(Date.parse("2026-08-20T01:00:00.000Z"));
  });

  it("reassigns a due same_task cron occurrence in its existing thread", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:50:00.000Z")); // 17:50 Asia/Shanghai
    const recurring = cronTemplate("0 10 * * *", { occurrence_mode: "same_task" }); // 10:00 Asia/Shanghai
    const firstDue = nextRunAt(recurring.id); // 2026-08-20T02:00:00Z (tomorrow 10:00 Asia/Shanghai)
    expect(firstDue).toBe(Date.parse("2026-08-20T02:00:00.000Z"));
    const first = createInitialOccurrence(recurring);
    repos.tasks.update(first.task_id, { status: "in_review" });

    vi.setSystemTime(new Date("2026-08-20T02:00:01.000Z"));
    (await worker()).tick();

    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);
    expect(repos.tasks.getById(first.task_id)).toMatchObject({ status: "open", thread_id: first.thread_id });
    expect(nextRunAt(recurring.id)).toBe(Date.parse("2026-08-21T02:00:00.000Z"));
    expect(dispatcher.events).toEqual(["MESSAGE_CREATE", "TASK_UPDATED"]);
  });
});
