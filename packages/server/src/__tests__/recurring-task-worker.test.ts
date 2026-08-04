import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { GatewayDispatcher } from "../ws/dispatcher.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos, type Repos } from "../repos/index.js";
import type { Channel, Message, Task } from "@cove/shared";

class RecordingDispatcher extends GatewayDispatcher {
  readonly events: string[] = [];

  constructor(repos: Repos) {
    super(repos.channels, repos.guilds);
  }

  override messageCreate(_message: Message): void { this.events.push("MESSAGE_CREATE"); }
  override threadCreate(_thread: Channel): void { this.events.push("THREAD_CREATE"); }
  override taskCreated(_task: Task): void { this.events.push("TASK_CREATED"); }
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

  function template(scheduleType: "interval" | "on_complete", intervalMs = 1_000) {
    return repos.recurringTasks.create({
      guild_id: guildId,
      channel_id: channelId,
      title: "Recurring report",
      created_by: "creator",
      schedule_type: scheduleType,
      interval_ms: scheduleType === "interval" ? intervalMs : 0,
      heartbeat_interval_ms: 20_000,
    });
  }

  it("spawns an ordinary task in a fresh thread with lifecycle events and recurring linkage", async () => {
    const recurring = template("on_complete");
    (await worker()).tick();

    const tasks = repos.tasks.listByChannel(channelId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ recurring_id: recurring.id, recurring_seq: 1, created_by: "creator", heartbeat_interval_ms: 20_000 });
    const thread = repos.channels.getById(tasks[0].thread_id);
    expect(thread).toMatchObject({ type: 11, parent_id: channelId });
    expect(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE channel_id = ?").get(tasks[0].thread_id)).toEqual({ count: 1 });
    expect(dispatcher.events).toEqual(["MESSAGE_CREATE", "THREAD_CREATE", "MESSAGE_CREATE", "TASK_CREATED"]);
    expect(repos.recurringTasks.getById(recurring.id)).toMatchObject({ last_task_id: tasks[0].task_id, last_spawned_at: expect.any(Number) });
  });

  it("does not overlap an open occurrence and spawns on completion for on_complete", async () => {
    const recurring = template("on_complete");
    const recurringWorker = await worker();
    recurringWorker.tick();
    recurringWorker.tick();
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);

    const first = repos.recurringTasks.getById(recurring.id)!;
    repos.tasks.update(first.last_task_id!, { status: "done" });
    recurringWorker.tick();
    const tasks = repos.tasks.listByChannel(channelId);
    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toMatchObject({ recurring_id: recurring.id, recurring_seq: 2, status: "open" });
  });

  it("waits for the full interval after a long-running occurrence completes and ignores disabled templates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const recurring = template("interval", 10_000);
    const disabled = template("on_complete");
    repos.recurringTasks.update(disabled.id, { enabled: false });
    const recurringWorker = await worker();
    recurringWorker.tick();
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);

    vi.advanceTimersByTime(30_000);
    const first = repos.recurringTasks.getById(recurring.id)!;
    repos.tasks.update(first.last_task_id!, { status: "done" });
    recurringWorker.tick();
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);

    vi.advanceTimersByTime(9_999);
    recurringWorker.tick();
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(1);

    vi.advanceTimersByTime(1);
    recurringWorker.tick();
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(2);
  });

  it("leaves the template unchanged when its creator or parent channel is missing", async () => {
    const recurring = template("on_complete");
    db.prepare("UPDATE recurring_tasks SET created_by = ? WHERE id = ?").run("missing-creator", recurring.id);
    (await worker()).tick();
    expect(repos.tasks.listByChannel(channelId)).toHaveLength(0);
    expect(repos.recurringTasks.getById(recurring.id)).toMatchObject({ last_task_id: null, last_spawned_at: 0 });
  });
});
