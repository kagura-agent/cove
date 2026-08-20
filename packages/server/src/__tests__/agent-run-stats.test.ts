import { describe, expect, it, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos, type Repos } from "../repos/index.js";
import { createTaskOccurrence } from "../services/task-occurrence.js";
import type { Task } from "@cove/shared";

describe("agent_run_stats materialization (#572 Phase 1.5)", () => {
  let db: Database.Database;
  let repos: Repos;
  let guildId: string;
  let channelId: string;
  let logRoot: string;

  beforeEach(() => {
    db = initDb(":memory:");
    guildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, guildId);
    channelId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;
    repos = createRepos(db);
    logRoot = mkdtempSync(join(tmpdir(), "cove-stats-"));
    (repos.agentRuns as any).root = logRoot;
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("agent", "Agent", null, 1, now, now);
    db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, "agent", null, "[]", now);
  });

  function createTask(title: string): Task {
    const occurrence = repos.db.transaction(() => createTaskOccurrence(repos, {
      channel: repos.channels.getById(channelId)!,
      creator: repos.users.getById("agent")!,
      title,
    }))();
    return occurrence.task;
  }

  function trigger(task: Task): string {
    const id = `msg-${task.task_id}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare("INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, task.thread_id, "agent", "Agent", "go", Date.now(), null, null);
    return id;
  }

  function statsRow(runId: string) {
    return db.prepare("SELECT * FROM agent_run_stats WHERE run_id=?").get(runId) as Record<string, unknown> | undefined;
  }

  it("materializes stats on the terminal event (tool counts + duration + cost)", () => {
    const task = createTask("Materialize on terminal");
    const run = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: trigger(task) });
    repos.agentRuns.append(run.run_id, { type: "run_started" as never });
    repos.agentRuns.append(run.run_id, { type: "tool_started" as never, action: "exec" });
    repos.agentRuns.append(run.run_id, { type: "tool_failed" as never, action: "command gh pr checks 529 --repo kagura-agent/cove 2>&1" });
    // No stats row yet while active.
    expect(statsRow(run.run_id)).toBeUndefined();
    repos.agentRuns.append(run.run_id, { type: "run_finished" as never });
    const row = statsRow(run.run_id)!;
    expect(row).toBeDefined();
    expect(row.status).toBe("completed");
    expect(row.tool_calls).toBe(1);
    expect(row.tool_failures).toBe(1);
    expect(row.failure_rate).toBe(1);
    expect(JSON.parse(row.top_failing_commands as string)).toEqual([
      { command: "gh pr checks 529 --repo kagura-agent/cove", failures: 1 },
    ]);
    expect(row.usage_finalized).toBe(0);
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("refreshes usage fields when usage arrives after the terminal event (agent_end)", () => {
    const task = createTask("Late usage");
    const run = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: trigger(task) });
    repos.agentRuns.append(run.run_id, { type: "run_started" as never });
    repos.agentRuns.append(run.run_id, { type: "run_finished" as never });
    expect((statsRow(run.run_id) as any).usage_calls).toBe(0);
    expect((statsRow(run.run_id) as any).cost).toBeNull();
    // Usage reported after terminal — must refresh the stats row.
    repos.agentRuns.recordUsage(run.run_id, { provider: "p", model: "m", input_tokens: 100, output_tokens: 50, cache_read_tokens: 900, cost: 0.05, cost_source: "price_table" });
    const row = statsRow(run.run_id)!;
    expect(row.usage_calls).toBe(1);
    expect(row.cost).toBe(0.05);
    expect(row.input_tokens).toBe(100);
    expect(row.cache_read_tokens).toBe(900);
    expect(row.usage_finalized).toBe(0);
  });

  it("finalizeStats marks terminal runs after the window; active runs stay unfinalized", () => {
    const task = createTask("Finalize window");
    const done = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: trigger(task) });
    repos.agentRuns.append(done.run_id, { type: "run_started" as never });
    repos.agentRuns.append(done.run_id, { type: "run_finished" as never });
    const active = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: trigger(task) });
    repos.agentRuns.append(active.run_id, { type: "run_started" as never });
    // Backdate the terminal row beyond the window.
    db.prepare("UPDATE agent_run_stats SET computed_at=? WHERE run_id=?").run(Date.now() - 120_000, done.run_id);
    const finalized = repos.agentRuns.finalizeStats(60_000);
    expect(finalized).toBe(1);
    expect((statsRow(done.run_id) as any).usage_finalized).toBe(1);
    // Active runs have no stats row at all (materialized only on terminal) —
    // finalize must leave them alone.
    expect(statsRow(active.run_id)).toBeUndefined();
    expect(repos.agentRuns.get(active.run_id)?.status).toBe("active");
  });

  it("materializes stats for stale runs via expire (no terminal event exists)", () => {
    const task = createTask("Stale materialize");
    const run = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: trigger(task) });
    repos.agentRuns.append(run.run_id, { type: "run_started" as never });
    repos.agentRuns.append(run.run_id, { type: "tool_started" as never, action: "exec" });
    expect(statsRow(run.run_id)).toBeUndefined();
    db.prepare("UPDATE agent_runs SET expires_at=? WHERE run_id=?").run(Date.now() - 1000, run.run_id);
    repos.agentRuns.expire({ threadId: task.thread_id });
    const row = statsRow(run.run_id)!;
    expect(row).toBeDefined();
    expect(row.status).toBe("stale");
    expect(row.tool_calls).toBe(1);
  });

  it("lazily backfills a missing stats row on query and returns correct aggregates", () => {
    const task = createTask("Lazy backfill");
    const run = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: trigger(task) });
    repos.agentRuns.append(run.run_id, { type: "run_started" as never });
    repos.agentRuns.append(run.run_id, { type: "tool_started" as never, action: "exec" });
    repos.agentRuns.append(run.run_id, { type: "tool_started" as never, action: "exec" });
    repos.agentRuns.append(run.run_id, { type: "tool_failed" as never, action: "gh pr checks 529 --repo kagura-agent/cove" });
    repos.agentRuns.append(run.run_id, { type: "run_finished" as never });
    repos.agentRuns.recordUsage(run.run_id, { provider: "p", model: "m", input_tokens: 100, output_tokens: 50, cost: 0.10, cost_source: "price_table" });
    // Simulate a rebuilt cache: drop the materialized row.
    db.prepare("DELETE FROM agent_run_stats WHERE run_id=?").run(run.run_id);
    expect(statsRow(run.run_id)).toBeUndefined();
    const report = repos.taskEfficiency.report(task.task_id)!;
    expect(report.tool_health).toMatchObject({ tool_calls: 2, failures: 1, failure_rate: 0.5 });
    expect(report.cost).toMatchObject({ calls: 1, cost: 0.10 });
    expect(report.run_health).toMatchObject({ runs: 1, completed: 1, completion_rate: 1 });
    // Backfill wrote the row back.
    const row = statsRow(run.run_id)!;
    expect(row).toBeDefined();
    expect(row.tool_calls).toBe(2);
  });

  it("materialized path and on-demand path produce identical tool aggregates", () => {
    const task = createTask("Parity");
    const run = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: trigger(task) });
    repos.agentRuns.append(run.run_id, { type: "run_started" as never });
    repos.agentRuns.append(run.run_id, { type: "tool_started" as never, action: "exec" });
    repos.agentRuns.append(run.run_id, { type: "tool_failed" as never, action: "command gh pr checks 529 2>&1" });
    repos.agentRuns.append(run.run_id, { type: "tool_failed" as never, action: "gh pr checks 529 2>&1 (agent)" });
    repos.agentRuns.append(run.run_id, { type: "run_finished" as never });
    // Materialized (row exists).
    const withCache = repos.taskEfficiency.report(task.task_id)!.tool_health!;
    // On-demand (drop row → lazy backfill reads events.jsonl directly).
    db.prepare("DELETE FROM agent_run_stats WHERE run_id=?").run(run.run_id);
    const withoutCache = repos.taskEfficiency.report(task.task_id)!.tool_health!;
    expect(withoutCache).toEqual(withCache);
    expect(withCache).toMatchObject({ tool_calls: 1, failures: 2, failure_rate: 2 });
    expect(withCache.top_failing_commands).toEqual([{ command: "gh pr checks 529", failures: 2 }]);
  });
});
