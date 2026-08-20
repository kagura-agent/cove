import type { AgentRun, AgentRunEvent, AgentRunUsage } from "@cove/shared";

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

export interface RunStatsInput {
  run: AgentRun;
  events: AgentRunEvent[];
  usage: AgentRunUsage | null;
}

/** Shape of a materialized agent_run_stats row (JSON columns decoded). */
export interface RunStatsRow {
  run_id: string;
  status: string;
  tool_calls: number;
  tool_failures: number;
  failure_rate: number | null;
  top_failing_commands: Array<{ command: string; failures: number }>;
  repeated_commands: Array<{ command: string; occurrences: number }>;
  cost: number | null;
  usage_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  duration_ms: number | null;
  usage_finalized: number;
  computed_at: number;
}

/** Per-run facts computed from evidence (events.jsonl + usage ledger). These are
 *  immutable once the run is terminal — the materialized cache stores exactly
 *  this shape, and the on-demand path recomputes it when the cache row is
 *  missing (e.g. legacy runs before V41, or a rebuilt DB). Tool counts and
 *  duration are final at terminal time; usage may arrive late (agent_end hook
 *  fires just after run_finished), so usage fields are refreshed on
 *  recordUsage and marked final only after the finalize window. */
export function computeRunStats(input: RunStatsInput): Omit<RunStatsRow, "run_id" | "computed_at"> {
  const { run, events, usage } = input;
  const started = events.filter((e) => e.type === "tool_started");
  const failed = events.filter((e) => e.type === "tool_failed");
  const failByCmd = new Map<string, number>();
  for (const e of failed) {
    if (!e.action) continue;
    const key = normalizeCommand(e.action);
    failByCmd.set(key, (failByCmd.get(key) ?? 0) + 1);
  }
  const sorted = [...failByCmd.entries()].sort((a, b) => b[1] - a[1]);
  const durationMs = run.finished_at != null && run.started_at != null && run.finished_at >= run.started_at
    ? run.finished_at - run.started_at
    : null;
  return {
    status: run.status,
    tool_calls: started.length,
    tool_failures: failed.length,
    failure_rate: started.length ? failed.length / started.length : null,
    top_failing_commands: sorted.slice(0, TOP_FAILING_LIMIT).map(([command, failures]) => ({ command, failures })),
    repeated_commands: sorted.filter(([, n]) => n > 1).map(([command, occurrences]) => ({ command, occurrences })),
    cost: usage?.cost ?? null,
    usage_calls: usage?.calls ?? 0,
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    cache_read_tokens: usage?.cache_read_tokens ?? 0,
    cache_write_tokens: usage?.cache_write_tokens ?? 0,
    total_tokens: usage?.total_tokens ?? 0,
    duration_ms: durationMs,
    usage_finalized: 0,
  };
}
