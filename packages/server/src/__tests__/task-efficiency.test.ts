import { describe, expect, it, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos, type Repos } from "../repos/index.js";
import { createTaskOccurrence } from "../services/task-occurrence.js";
import type { AgentRunsRepo } from "../repos/agent-runs.js";
import { normalizeCommand } from "../repos/task-efficiency.js";
import type { Task } from "@cove/shared";

describe("task efficiency query layer (#572)", () => {
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
    logRoot = mkdtempSync(join(tmpdir(), "cove-eff-"));
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

  /** Insert a real trigger message in the task thread and return its id. */
  function triggerMessage(task: Task): string {
    const id = `msg-${task.task_id}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    db.prepare("INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, task.thread_id, "agent", "Agent", "trigger", now, null, null);
    return id;
  }

  /** Full run in the task's thread: start → events → finish, with usage. */
  function executeTaskRun(task: Task, events: Array<{ type: string; action?: string; exit_code?: number }>, usage?: { input?: number; output?: number; cacheRead?: number; cost?: number }, agentId = "agent") {
    const run = repos.agentRuns.start({ agent_id: agentId, channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: triggerMessage(task) });
    for (const ev of events) {
      repos.agentRuns.append(run.run_id, ev as never);
    }
    if (usage) {
      repos.agentRuns.recordUsage(run.run_id, {
        provider: "floway", model: "deepseek-v4-flash",
        input_tokens: usage.input ?? 0, output_tokens: usage.output ?? 0,
        cache_read_tokens: usage.cacheRead ?? 0, cost: usage.cost, cost_source: "price_table",
      });
    }
    return run;
  }

  describe("normalizeCommand", () => {
    it("collapses command prefixes, trailing 2>&1 and (agent) suffixes, whitespace and case", () => {
      expect(normalizeCommand("command gh pr checks 529 --repo kagura-agent/cove 2>&1")).toBe("gh pr checks 529 --repo kagura-agent/cove");
      expect(normalizeCommand("gh pr checks 529 --repo kagura-agent/cove 2>&1 (agent)")).toBe("gh pr checks 529 --repo kagura-agent/cove");
      expect(normalizeCommand("  GH   PR  checks   529  --repo kagura-agent/cove ")).toBe("gh pr checks 529 --repo kagura-agent/cove");
    });

    it("keeps genuinely different invocations separate", () => {
      expect(normalizeCommand("sleep 5 && gh pr checks 529 --repo kagura-agent/cove")).not.toBe("gh pr checks 529 --repo kagura-agent/cove");
    });
  });

  it("computes cost, tool health, run health and baseline for a task with data", () => {
    const task = createTask("Efficiency test");
    // Two runs: one completes, one is superseded/stale.
    executeTaskRun(task, [
      { type: "run_started" },
      { type: "tool_started", action: "exec" },
      { type: "tool_started", action: "exec" },
      { type: "tool_failed", action: "command gh pr checks 529 --repo kagura-agent/cove 2>&1" },
      { type: "run_finished" },
    ], { input: 1_000, output: 500, cacheRead: 2_000, cost: 0.25 });
    executeTaskRun(task, [
      { type: "run_started" },
      { type: "tool_started", action: "exec" },
      { type: "tool_failed", action: "gh pr checks 529 --repo kagura-agent/cove 2>&1 (agent)" },
    ], undefined);
    // The second start superseded the first? No — different trigger messages
    // in the same scope stale the first. Build a separate thread run instead to
    // keep both completed/stale semantics explicit:
    const r2 = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: triggerMessage(task) });
    repos.agentRuns.append(r2.run_id, { type: "run_started" as never });
    repos.agentRuns.append(r2.run_id, { type: "tool_started" as never, action: "exec" });
    repos.agentRuns.append(r2.run_id, { type: "tool_failed" as never, action: "gh pr checks 529 --repo kagura-agent/cove 2>&1 (agent)" });
    repos.agentRuns.append(r2.run_id, { type: "run_finished" as never });

    const report = repos.taskEfficiency.report(task.task_id)!;
    expect(report).not.toBeNull();
    expect(report.has_data).toBe(true);
    // Cost: one usage call on the first run.
    expect(report.cost).toMatchObject({ calls: 1, cost: 0.25 });
    // Tool health: 4 tool_started (2 run1 + 1 run2 + 1 r2), 3 failures, all
    // the same command → failure rate 3/4, repeated command reported once.
    expect(report.tool_health).toMatchObject({
      tool_calls: 4,
      failures: 3,
      failure_rate: 0.75,
    });
    expect(report.tool_health!.top_failing_commands).toEqual([
      { command: "gh pr checks 529 --repo kagura-agent/cove", failures: 3 },
    ]);
    expect(report.tool_health!.repeated_commands).toEqual([
      { command: "gh pr checks 529 --repo kagura-agent/cove", occurrences: 3 },
    ]);
    // Run health: 3 runs, 1 session, 2 completed + 1 stale → completion 2/3.
    expect(report.run_health).toMatchObject({ runs: 3, sessions: 1, completed: 2, stale: 1, completion_rate: 2 / 3 });
    // Baseline over siblings: this is the only task → nothing to compare.
    expect(report.baseline).toMatchObject({ scope: "channel", tasks_included: 0, median_cost: null, median_failure_rate: null });
    expect(report.cost_delta_vs_median).toBeNull();
    expect(report.failure_rate_delta_vs_median).toBeNull();
  });

  it("handles a task with zero runs/usage gracefully (has_data=false, nulls)", () => {
    const task = createTask("No data task");
    const report = repos.taskEfficiency.report(task.task_id)!;
    expect(report.has_data).toBe(false);
    expect(report.cost).toBeNull();
    expect(report.tool_health).toBeNull();
    expect(report.run_health).toBeNull();
    // Baseline still computed (no siblings here → empty).
    expect(report.baseline.tasks_included).toBe(0);
    // Non-existent task → null.
    expect(repos.taskEfficiency.report("nope")).toBeNull();
  });

  it("computes channel baseline medians across sibling tasks (excludes the reported task)", () => {
    const cheap = createTask("Cheap task");
    const spendy = createTask("Spendy task");
    // cheap: 1 call, $0.10, 1 tool call 0 failures → failure rate 0
    executeTaskRun(cheap, [
      { type: "run_started" },
      { type: "tool_started", action: "read" },
      { type: "run_finished" },
    ], { input: 100, output: 100, cost: 0.10 });
    // spendy: 2 calls, $0.30 total, 2 tool calls 1 failure → failure rate 0.5
    executeTaskRun(spendy, [
      { type: "run_started" },
      { type: "tool_started", action: "exec" },
      { type: "tool_started", action: "exec" },
      { type: "tool_failed", action: "gh pr checks 529 --repo kagura-agent/cove" },
      { type: "run_finished" },
    ], { input: 200, output: 200, cost: 0.20 });
    executeTaskRun(spendy, [
      { type: "run_started" },
      { type: "tool_started", action: "exec" },
      { type: "run_finished" },
    ], { input: 50, output: 50, cost: 0.10 });

    const cheapReport = repos.taskEfficiency.report(cheap.task_id)!;
    const spendyReport = repos.taskEfficiency.report(spendy.task_id)!;
    // cheap's baseline: spendy is the only sibling → median cost 0.30, median failure rate 1/3
    // (spendy has 3 tool calls, 1 failure across its two runs).
    expect(cheapReport.baseline.scope).toBe("channel");
    expect(cheapReport.baseline.tasks_included).toBe(1);
    expect(cheapReport.baseline.median_cost).toBeCloseTo(0.30);
    expect(cheapReport.baseline.median_failure_rate).toBeCloseTo(1 / 3);
    // cheap is $0.10 vs $0.30 median → -$0.20; failure rate 0 vs 1/3 → -1/3
    expect(cheapReport.cost_delta_vs_median).toBeCloseTo(-0.20);
    expect(cheapReport.failure_rate_delta_vs_median).toBeCloseTo(-1 / 3);
    // spendy's baseline: cheap is the only sibling → median cost 0.10, median failure rate 0
    expect(spendyReport.baseline.tasks_included).toBe(1);
    expect(spendyReport.baseline.median_cost).toBeCloseTo(0.10);
    expect(spendyReport.baseline.median_failure_rate).toBe(0);
    expect(spendyReport.cost_delta_vs_median).toBeCloseTo(0.20);
    expect(spendyReport.failure_rate_delta_vs_median).toBeCloseTo(1 / 3);
  });

  it("channelReports shares one baseline across tasks and covers tasks without data", () => {
    const a = createTask("A");
    const b = createTask("B");
    executeTaskRun(a, [{ type: "run_started" }, { type: "tool_started", action: "read" }, { type: "run_finished" }], { cost: 0.10 });
    // b has no data at all.
    const reports = repos.taskEfficiency.channelReports(channelId);
    const byId = new Map(reports.map((r) => [r.task_id, r]));
    expect(byId.size).toBe(2);
    expect(byId.get(a.task_id)!.has_data).toBe(true);
    expect(byId.get(b.task_id)!.has_data).toBe(false);
    expect(byId.get(b.task_id)!.cost).toBeNull();
    // Both share the same baseline: channel-wide (includes both tasks, not
    // excluding self — this is the "vs channel median" view; the single-task
    // endpoint excludes self for the "vs siblings" view). b has no cost, so the
    // median only covers a → 0.10.
    expect(byId.get(a.task_id)!.baseline.tasks_included).toBe(2);
    expect(byId.get(a.task_id)!.baseline.median_cost).toBe(0.10);
    expect(byId.get(b.task_id)!.baseline.median_cost).toBe(0.10);
  });

  it("verifies the #533 known case values ($1.37, 11 calls, 13 runs)", () => {
    // Construct the exact acceptance scenario: 13 runs, 11 usage calls, $1.37.
    const task = createTask("实现 #533 — recurring cron / time-of-day 调度");
    let costSum = 0;
    for (let i = 0; i < 13; i++) {
      const run = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: triggerMessage(task) });
      repos.agentRuns.append(run.run_id, { type: "run_started" as never });
      repos.agentRuns.append(run.run_id, { type: "tool_started" as never, action: "exec" });
      repos.agentRuns.append(run.run_id, { type: "run_finished" as never });
      // 11 of the 13 runs carry usage; the rest have none.
      if (i < 11) {
        const cost = 0.1245; // sums to ~1.37 over 11 calls
        costSum += cost;
        repos.agentRuns.recordUsage(run.run_id, { provider: "floway", model: "deepseek-v4-flash", input_tokens: 100_000, output_tokens: 50_000, cache_read_tokens: 900_000, cost, cost_source: "price_table" });
      }
    }
    const report = repos.taskEfficiency.report(task.task_id)!;
    expect(report.cost!.calls).toBe(11);
    expect(report.cost!.cost).toBeCloseTo(1.37, 2);
    expect(report.run_health!.runs).toBe(13);
    expect(report.run_health!.completion_rate).toBe(1); // all 13 finished
  });

  it("counts sessions as distinct agents in a thread", () => {
    const task = createTask("Multi-agent task");
    db.prepare("INSERT INTO users (id, username, avatar, bot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("second-agent", "SecondAgent", null, 1, Date.now(), Date.now());
    executeTaskRun(task, [{ type: "run_started" }, { type: "run_finished" }]);
    executeTaskRun(task, [{ type: "run_started" }, { type: "run_finished" }], undefined, "second-agent");
    const report = repos.taskEfficiency.report(task.task_id)!;
    expect(report.run_health!.sessions).toBe(2);
    expect(report.run_health!.runs).toBe(2);
  });

  it("reports aborted and failed runs in completion rate", () => {
    const task = createTask("Aborted task");
    const r1 = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: triggerMessage(task) });
    repos.agentRuns.append(r1.run_id, { type: "run_started" as never });
    repos.agentRuns.append(r1.run_id, { type: "run_aborted" as never });
    const r2 = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: triggerMessage(task) });
    repos.agentRuns.append(r2.run_id, { type: "run_started" as never });
    repos.agentRuns.append(r2.run_id, { type: "run_failed" as never });
    const r3 = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: triggerMessage(task) });
    repos.agentRuns.append(r3.run_id, { type: "run_started" as never });
    repos.agentRuns.append(r3.run_id, { type: "run_finished" as never });
    const report = repos.taskEfficiency.report(task.task_id)!;
    expect(report.run_health).toMatchObject({ runs: 3, completed: 1, failed: 1, aborted: 1, completion_rate: 1 / 3 });
    expect(report.run_health!.duration_ms_total).toBeGreaterThanOrEqual(0);
  });

  it("returns null tool health when no tool events exist", () => {
    const task = createTask("No tool events");
    const r = repos.agentRuns.start({ agent_id: "agent", channel_id: task.channel_id, thread_id: task.thread_id, trigger_message_id: triggerMessage(task) });
    repos.agentRuns.append(r.run_id, { type: "run_started" as never });
    repos.agentRuns.append(r.run_id, { type: "run_finished" as never });
    const report = repos.taskEfficiency.report(task.task_id)!;
    expect(report.tool_health).toBeNull();
    expect(report.run_health!.runs).toBe(1);
  });
});
