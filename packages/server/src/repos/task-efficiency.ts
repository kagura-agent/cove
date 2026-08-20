import type Database from "better-sqlite3";
import type { AgentRunsRepo } from "./agent-runs.js";
import type { TasksRepo } from "./tasks.js";
import type {
  AgentRun,
  Task,
  TaskEfficiencyBaseline,
  TaskEfficiencyReport,
  TaskRunHealth,
  TaskToolHealth,
} from "@cove/shared";

const TOP_FAILING_LIMIT = 10;

/** Strip noise around a failed command so the same command logged with minor
 *  variants collapses into one bucket:
 *  - "command gh pr checks 529 …" → "gh pr checks 529 …" (Claude Code style)
 *  - trailing " 2>&1" and " (agent)" suffixes
 *  - collapsed whitespace + lowercase
 *  Deliberately does NOT strip "sleep N &&" style prefixes or reorder args —
 *  those are genuinely different invocations and stay separate buckets.
 */
export function normalizeCommand(raw: string): string {
  let cmd = raw.replace(/\s+/g, " ").trim();
  // Strip suffixes in an order that handles combined variants like
  // "… 2>&1 (agent)": trailing markers are removed right-to-left.
  cmd = cmd.replace(/\s+\(agent\)\s*$/, "");
  cmd = cmd.replace(/ 2>&1\s*$/, "");
  cmd = cmd.replace(/^command\s+/, "");
  return cmd.toLowerCase();
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface ToolStats {
  calls: number;
  failures: number;
}

/**
 * Phase 1 of #572 — per-task execution efficiency computed from existing data
 * (agent_run_usage + agent_runs + events.jsonl), no schema changes.
 *
 * Task association follows the canonical tasks.thread_id link (same rule as
 * AgentRunsRepo.usageByScope): runs belong to a task when their thread_id
 * matches the task's thread.
 *
 * Metric definitions:
 *  - cost: reuse of the existing AgentRunUsage rollup for the task scope.
 *  - tool health: counted from events.jsonl evidence. tool_started = a tool
 *    call; tool_failed = a failure. The failing command is the event's action
 *    (the plugin records the full command there for exec failures). "Repeated
 *    commands" = the same normalized command failed more than once — the
 *    retry-waste signal (#572: gh pr checks 529 failed 119× / 262 failures).
 *  - run health: agent_runs rows in the task's thread. Sessions have no
 *    dedicated column — the plugin creates a fresh thread session per task, so
 *    distinct agent_id is the session proxy. Completion rate counts runs that
 *    reached a terminal status (completed / completed+failed+aborted+stale);
 *    stale runs (superseded or expired mid-turn) count as not clean, matching
 *    the issue's "~8% runs don't finish cleanly" observation.
 *  - baseline: median cost and median tool failure rate across sibling tasks
 *    (same channel, or all tasks with scope="all").
 */
export class TaskEfficiencyRepo {
  constructor(
    private db: Database.Database,
    private tasks: TasksRepo,
    private agentRuns: AgentRunsRepo,
  ) {}

  /** Full efficiency report for one task. Null when the task doesn't exist or
   *  has no thread. Tasks without runs/usage are handled gracefully:
   *  has_data=false, cost/run_health/tool_health null, baseline still computed. */
  report(taskId: string, opts: { baselineScope?: "channel" | "all"; baseline?: TaskEfficiencyBaseline } = {}): TaskEfficiencyReport | null {
    const task = this.tasks.getById(taskId);
    if (!task || !task.thread_id) return null;
    const scope = opts.baselineScope ?? "channel";
    const runs = this.runsForThread(task.thread_id);
    const usage = this.agentRuns.usageByScope({ taskId });
    const tool = this.toolHealth(runs.map((r) => r.run_id));
    const runHealth = runs.length ? this.runHealth(runs) : null;
    const baseline = opts.baseline ?? (scope === "all"
      ? this.computeBaseline(this.allTaskIds(), taskId, "all")
      : this.computeBaseline(this.tasks.listByChannel(task.channel_id), taskId, "channel"));
    const costDelta = usage?.cost != null && baseline.median_cost != null ? usage.cost - baseline.median_cost : null;
    const failureDelta = tool?.failure_rate != null && baseline.median_failure_rate != null ? tool.failure_rate - baseline.median_failure_rate : null;
    return {
      task_id: taskId,
      has_data: runs.length > 0 || usage !== null,
      cost: usage,
      tool_health: tool,
      run_health: runHealth,
      baseline,
      cost_delta_vs_median: costDelta,
      failure_rate_delta_vs_median: failureDelta,
    };
  }

  /** Reports for every task in a channel, sharing one channel-wide baseline
   *  (computed once instead of per task — avoids O(n²) event-file reads). */
  channelReports(channelId: string, opts: { baselineScope?: "channel" | "all" } = {}): TaskEfficiencyReport[] {
    const tasks = this.tasks.listByChannel(channelId);
    if (!tasks.length) return [];
    const scope = opts.baselineScope ?? "channel";
    const baseline = scope === "all"
      ? this.computeBaseline(this.allTaskIds(), undefined, "all")
      : this.computeBaseline(tasks, undefined, "channel");
    return tasks
      .map((t) => this.report(t.task_id, { baseline }))
      .filter((r): r is TaskEfficiencyReport => r !== null);
  }

  private runsForThread(threadId: string): AgentRun[] {
    return this.db.prepare("SELECT * FROM agent_runs WHERE thread_id = ? ORDER BY started_at").all(threadId) as AgentRun[];
  }

  private allTaskIds(): Array<{ task_id: string }> {
    return this.db.prepare("SELECT task_id FROM tasks").all() as Array<{ task_id: string }>;
  }

  /** Tool ledger health from events.jsonl evidence for the given runs. */
  private toolHealth(runIds: string[]): TaskToolHealth | null {
    if (!runIds.length) return null;
    const events = runIds.flatMap((id) => this.agentRuns.events(id));
    const started = events.filter((e) => e.type === "tool_started");
    const failed = events.filter((e) => e.type === "tool_failed");
    if (!started.length && !failed.length) return null;
    const failByCmd = new Map<string, number>();
    for (const e of failed) {
      if (!e.action) continue;
      const key = normalizeCommand(e.action);
      failByCmd.set(key, (failByCmd.get(key) ?? 0) + 1);
    }
    const sorted = [...failByCmd.entries()].sort((a, b) => b[1] - a[1]);
    return {
      tool_calls: started.length,
      failures: failed.length,
      failure_rate: started.length ? failed.length / started.length : null,
      top_failing_commands: sorted.slice(0, TOP_FAILING_LIMIT).map(([command, failures]) => ({ command, failures })),
      repeated_commands: sorted.filter(([, n]) => n > 1).map(([command, occurrences]) => ({ command, occurrences })),
    };
  }

  /** Run ledger health from agent_runs rows (statuses + durations). */
  private runHealth(runs: AgentRun[]): TaskRunHealth {
    const count = (s: AgentRun["status"]) => runs.filter((r) => r.status === s).length;
    const completed = count("completed");
    const failed = count("failed");
    const aborted = count("aborted");
    const stale = count("stale");
    const active = count("active");
    const terminal = completed + failed + aborted + stale;
    const durations = runs
      .filter((r) => r.finished_at != null && r.started_at != null && r.finished_at! >= r.started_at!)
      .map((r) => r.finished_at! - r.started_at);
    return {
      runs: runs.length,
      sessions: new Set(runs.map((r) => r.agent_id)).size,
      completed,
      failed,
      aborted,
      stale,
      active,
      completion_rate: terminal ? completed / terminal : null,
      duration_ms_median: median(durations),
      duration_ms_total: durations.reduce((a, b) => a + b, 0),
    };
  }

  /** Baseline medians over sibling tasks (excluding the reported task). */
  private computeBaseline(tasks: Array<{ task_id: string }>, excludeTaskId: string | undefined, scope: "channel" | "all"): TaskEfficiencyBaseline {
    const siblings = tasks.filter((t) => t.task_id !== excludeTaskId);
    if (!siblings.length) return { scope, tasks_included: 0, median_cost: null, median_failure_rate: null };
    const costRows = this.db.prepare(
      `SELECT t.task_id, SUM(u.cost) AS cost
       FROM tasks t
       LEFT JOIN agent_runs r ON r.thread_id = t.thread_id
       LEFT JOIN agent_run_usage u ON u.run_id = r.run_id
       WHERE t.task_id IN (${siblings.map(() => "?").join(",")})
       GROUP BY t.task_id`,
    ).all(...siblings.map((t) => t.task_id)) as Array<{ task_id: string; cost: number | null }>;
    const costs = costRows.map((r) => r.cost).filter((c): c is number => typeof c === "number");
    const toolStats = this.taskToolStats(siblings.map((t) => t.task_id));
    const failureRates = [...toolStats.values()].filter((s) => s.calls > 0).map((s) => s.failures / s.calls);
    return {
      scope,
      tasks_included: siblings.length,
      median_cost: median(costs),
      median_failure_rate: median(failureRates),
    };
  }

  /** Lightweight per-task tool stats (calls/failures) — baseline needs only
   *  the failure rate, not the full top-command breakdown. */
  private taskToolStats(taskIds: string[]): Map<string, ToolStats> {
    const stats = new Map<string, ToolStats>(taskIds.map((id) => [id, { calls: 0, failures: 0 }]));
    if (!taskIds.length) return stats;
    const threadRows = this.db.prepare(
      `SELECT task_id, thread_id FROM tasks WHERE task_id IN (${taskIds.map(() => "?").join(",")})`,
    ).all(...taskIds) as Array<{ task_id: string; thread_id: string }>;
    const taskByThread = new Map(threadRows.map((r) => [r.thread_id, r.task_id]));
    if (!taskByThread.size) return stats;
    const threads = [...taskByThread.keys()];
    const runs = this.db.prepare(
      `SELECT run_id, thread_id FROM agent_runs WHERE thread_id IN (${threads.map(() => "?").join(",")})`,
    ).all(...threads) as Array<{ run_id: string; thread_id: string }>;
    for (const run of runs) {
      const taskId = taskByThread.get(run.thread_id);
      const s = taskId ? stats.get(taskId) : undefined;
      if (!s) continue;
      for (const ev of this.agentRuns.events(run.run_id)) {
        if (ev.type === "tool_started") s.calls += 1;
        else if (ev.type === "tool_failed") s.failures += 1;
      }
    }
    return stats;
  }
}
