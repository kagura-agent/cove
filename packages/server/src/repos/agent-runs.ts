import type Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentRun, AgentRunEvent, AgentRunEventType, AgentRunStatus, AgentRunUsage } from "@cove/shared";
import { computeRunStats, type RunStatsRow } from "./run-stats.js";

const MAX_DETAIL = 8_000;
/** Stale-claim window for a run with no event traffic. Long turns (model
 * thinking, file reads, subagent work) routinely exceed a 90s heartbeat gap,
 * so a short window mislabels live runs as stale and the terminal event then
 * bounces with 409. This is a crash-only safety net, not a liveness signal. */
const RUN_STALE_AFTER_MS = 30 * 60 * 1000;
const BEARER = /(authorization\s*[:=]\s*bearer\s+|bearer\s+)([^\s'"`]+)/gi;
const SECRET = /((?:api[_-]?key|token|secret|password|cookie)\s*[:=]\s*)([^\s'"`]+)/gi;
const ENV_VALUE = /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)\s*=\s*[^\s]+/g;
function safeText(value: unknown, max = MAX_DETAIL): string | null {
  if (typeof value !== "string") return null;
  const redacted = value.replace(BEARER, "$1[REDACTED]").replace(SECRET, "$1[REDACTED]").replace(ENV_VALUE, (m) => m.replace(/=.*/, "=[REDACTED]"));
  return redacted.length > max ? `${redacted.slice(0, max)}… [${redacted.length - max} bytes omitted]` : redacted;
}
function asRun(row: any): AgentRun { return row as AgentRun; }
function cleanId(value: string) { return value.replace(/[^a-zA-Z0-9_-]/g, "_"); }

/** SQL remains a permission/query index; durable evidence lives under one private directory per run. */
export class AgentRunsRepo {
  private root: string;
  constructor(private db: Database.Database, root = process.env.COVE_AGENT_RUN_LOG_DIR ?? join(process.cwd(), "data", "agent-runs")) {
    this.root = resolve(root); mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }
  private dir(runId: string) {
    // Run ids are server-generated, but keep the file boundary explicit before
    // touching disk so a future caller cannot escape the private log root.
    const dir = resolve(this.root, cleanId(runId));
    if (dir !== this.root && !dir.startsWith(`${this.root}/`)) throw new Error("Invalid agent run log path");
    return dir;
  }
  private logPath(runId: string) { return join(this.dir(runId), "events.jsonl"); }
  private legacyLogPath(runId: string) { return join(this.dir(runId), "events.ndjson"); }
  private readableLogPath(runId: string) {
    const current = this.logPath(runId);
    return existsSync(current) ? current : this.legacyLogPath(runId);
  }
  private writeManifest(run: AgentRun) {
    const dir = this.dir(run.run_id); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const payload = JSON.stringify({ version: 1, run_id: run.run_id, event_log: "events.jsonl", redaction_version: run.redaction_version, event_count: run.log_event_count, bytes: run.log_bytes, hash: run.log_hash, updated_at: run.updated_at }) + "\n";
    const tmp = join(dir, "manifest.json.tmp"); writeFileSync(tmp, payload, { mode: 0o600 }); renameSync(tmp, join(dir, "manifest.json"));
  }
  expire(scope?: { channelId?: string; threadId?: string }) {
    const now = Date.now(); let where = ""; const args: unknown[] = [now, now, now];
    // A thread run is anchored to its parent channel (channel_id = parent,
    // thread_id marks the thread), so a parent-channel scope must only expire
    // the channel's own runs — never a thread's runs behind its back. Match the
    // thread scope explicitly instead.
    if (scope?.threadId) { where = " AND thread_id=?"; args.push(scope.threadId); }
    else if (scope?.channelId) { where = " AND channel_id=? AND thread_id IS NULL"; args.push(scope.channelId); }
    const result = this.db.prepare(`UPDATE agent_runs SET status='stale', finished_at=?, updated_at=? WHERE status='active' AND expires_at < ?${where}`).run(...args);
    // Stale runs never emit a terminal event (crash / timeout / superseded) —
    // materialize their stats here so the cache covers every run type. Match
    // the same scope as the UPDATE above so we never re-materialize unrelated
    // stale runs from other threads/channels.
    if (result.changes > 0) {
      const staleWhere = scope?.threadId ? " AND thread_id=?" : scope?.channelId ? " AND channel_id=? AND thread_id IS NULL" : "";
      const staleArgs: unknown[] = [Date.now()];
      if (scope?.threadId) staleArgs.push(scope.threadId);
      else if (scope?.channelId) staleArgs.push(scope.channelId);
      const rows = this.db.prepare(`SELECT run_id FROM agent_runs WHERE status='stale' AND expires_at < ?${staleWhere} ORDER BY updated_at DESC LIMIT ?`).all(...staleArgs, result.changes) as Array<{ run_id: string }>;
      for (const { run_id } of rows) this.materializeStats(run_id);
    }
  }
  /**
   * Materialize the per-run stats row for a run (derived cache, #572).
   * Source of truth stays events.jsonl + agent_run_usage; this row is a
   * rebuildable cache for fast cross-run aggregation. Tool counts / duration
   * are final once the run is terminal; usage may still arrive (agent_end
   * hook), so usage fields are refreshed by recordUsage until the finalize
   * window closes (see usage_finalized).
   */
  materializeStats(runId: string): void {
    const run = this.get(runId);
    if (!run) return;
    // Cost is attributed to the run's own usage rows only (includeChildren=false):
    // subagent cost lands on the parent run's usage row already, and subagent
    // tool calls are not recorded in any events.jsonl, so children must stay out
    // of both sides of the stat to keep cost and tool counts on the same scope.
    const stats = computeRunStats({ run, events: this.events(runId), usage: this.usage(runId, false) });
    const row: RunStatsRow = { run_id: runId, computed_at: Date.now(), ...stats };
    this.db.prepare(`
      INSERT INTO agent_run_stats (run_id,status,tool_calls,tool_failures,failure_rate,top_failing_commands,repeated_commands,cost,usage_calls,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens,duration_ms,usage_finalized,computed_at)
      VALUES (@run_id,@status,@tool_calls,@tool_failures,@failure_rate,@top_failing_commands,@repeated_commands,@cost,@usage_calls,@input_tokens,@output_tokens,@cache_read_tokens,@cache_write_tokens,@total_tokens,@duration_ms,@usage_finalized,@computed_at)
      ON CONFLICT(run_id) DO UPDATE SET
        status=excluded.status, tool_calls=excluded.tool_calls, tool_failures=excluded.tool_failures,
        failure_rate=excluded.failure_rate, top_failing_commands=excluded.top_failing_commands,
        repeated_commands=excluded.repeated_commands, cost=excluded.cost, usage_calls=excluded.usage_calls,
        input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
        cache_read_tokens=excluded.cache_read_tokens, cache_write_tokens=excluded.cache_write_tokens,
        total_tokens=excluded.total_tokens, duration_ms=excluded.duration_ms,
        usage_finalized=excluded.usage_finalized, computed_at=excluded.computed_at
    `).run({
      run_id: row.run_id,
      status: row.status,
      tool_calls: row.tool_calls,
      tool_failures: row.tool_failures,
      failure_rate: row.failure_rate,
      top_failing_commands: JSON.stringify(row.top_failing_commands),
      repeated_commands: JSON.stringify(row.repeated_commands),
      cost: row.cost,
      usage_calls: row.usage_calls,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_read_tokens: row.cache_read_tokens,
      cache_write_tokens: row.cache_write_tokens,
      total_tokens: row.total_tokens,
      duration_ms: row.duration_ms,
      usage_finalized: row.usage_finalized,
      computed_at: row.computed_at,
    });
  }

  /** Refresh the usage portion of an existing stats row (agent_end may report
   *  after run_finished). Only touches usage fields; tool/duration facts are
   *  final. No-op when the run has no stats row yet (legacy/rebuild — the
   *  query layer lazily backfills it). */
  refreshStatsUsage(runId: string): void {
    const run = this.get(runId);
    if (!run) return;
    const usage = this.usage(runId, false);
    this.db.prepare(`
      UPDATE agent_run_stats SET
        cost=?, usage_calls=?, input_tokens=?, output_tokens=?, cache_read_tokens=?,
        cache_write_tokens=?, total_tokens=?, usage_finalized=0, computed_at=?
      WHERE run_id=?
    `).run(
      usage?.cost ?? null, usage?.calls ?? 0, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0,
      usage?.cache_read_tokens ?? 0, usage?.cache_write_tokens ?? 0, usage?.total_tokens ?? 0,
      Date.now(), runId,
    );
  }

  /** Mark stats rows finalized for terminal runs whose last usage refresh is
   *  older than the finalize window — after this, late usage is considered
   *  impossible and queries stop re-checking events for these runs. */
  finalizeStats(windowMs = 60_000): number {
    const cutoff = Date.now() - windowMs;
    const result = this.db.prepare(
      `UPDATE agent_run_stats SET usage_finalized=1
       WHERE usage_finalized=0 AND status != 'active' AND computed_at < ?`,
    ).run(cutoff);
    return result.changes;
  }

  /**
   * Same-scope turns are serialized by the plugin's per-channel debouncer, so a
   * second active run for the same (channel, thread, agent) can only be a
   * leftover from a turn that never reported its terminal event. Stale it
   * eagerly instead of waiting for the expiry window — genuine concurrency
   * lives across threads/channels, never within one scope. A task owns exactly
   * one thread, so per-thread serialization covers task executions too.
   */
  private staleSameScope(now: number, input: { agent_id: string; channel_id: string; thread_id?: string | null }): void {
    if (input.thread_id) {
      this.db.prepare("UPDATE agent_runs SET status='stale', finished_at=?, updated_at=? WHERE thread_id=? AND agent_id=? AND status='active'").run(now, now, input.thread_id, input.agent_id);
    } else {
      this.db.prepare("UPDATE agent_runs SET status='stale', finished_at=?, updated_at=? WHERE channel_id=? AND thread_id IS NULL AND agent_id=? AND status='active'").run(now, now, input.channel_id, input.agent_id);
    }
  }
  start(input: { agent_id: string; channel_id: string; trigger_message_id: string; thread_id?: string | null; parent_run_id?: string | null }): AgentRun {
    this.expire({ channelId: input.channel_id }); const now = Date.now(); const runId = randomUUID();
    // Any new run supersedes leftover active runs in its own scope. Task
    // executions are kept singleton through their thread (a task owns exactly
    // one thread), so no separate task_id branch is needed.
    this.staleSameScope(now, input);
    this.db.prepare(`INSERT INTO agent_runs (run_id,agent_id,channel_id,thread_id,trigger_message_id,assistant_message_id,parent_run_id,status,current_action,started_at,updated_at,finished_at,expires_at,log_manifest_ref,log_hash,log_event_count,log_bytes,redaction_version) VALUES (?,?,?,?,?,?,?, 'active',NULL,?,?,NULL,?,'manifest.json',NULL,0,0,1)`).run(runId,input.agent_id,input.channel_id,input.thread_id ?? null,input.trigger_message_id,null,input.parent_run_id ?? null,now,now,now+RUN_STALE_AFTER_MS);
    const run = this.get(runId)!; this.writeManifest(run); return run;
  }
  get(runId: string): AgentRun | null { const row = this.db.prepare("SELECT * FROM agent_runs WHERE run_id=?").get(runId); return row ? asRun(row) : null; }
  /**
   * Look up an execution from the message it finalized.  The channel predicate
   * is intentional: callers must not turn a globally-known message id into a
   * cross-channel execution-log lookup.
   */
  forAssistantMessage(channelId: string, assistantMessageId: string): AgentRun | null {
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE assistant_message_id=? AND ((thread_id IS NULL AND channel_id=?) OR thread_id=?) ORDER BY updated_at DESC LIMIT 1")
      .get(assistantMessageId, channelId, channelId);
    return row ? asRun(row) : null;
  }
  /**
   * Liveness probe for the heartbeat worker: is there an active run touching
   * this thread within the given window? Active runs mean the agent is
   * executing (silently or not) — the heartbeat must not fire.
   */
  hasActiveRun(threadId: string, sinceMs: number): boolean {
    const row = this.db.prepare("SELECT 1 FROM agent_runs WHERE thread_id=? AND status='active' AND updated_at >= ? LIMIT 1").get(threadId, sinceMs);
    return row !== undefined;
  }

  latest(input: { channelId?: string; threadId?: string }): AgentRun | null {
    // Expire the scope that actually owns the runs we're about to surface. A
    // thread lookup must expire by thread_id, otherwise zombie runs from
    // crashed dispatches stay 'active' and the run card shows forever.
    this.expire(input.threadId ? { threadId: input.threadId } : input.channelId ? { channelId: input.channelId } : undefined);
    if (input.threadId) {
      const row = this.db.prepare("SELECT * FROM agent_runs WHERE thread_id=? ORDER BY (status='active') DESC, updated_at DESC LIMIT 1").get(input.threadId);
      return row ? asRun(row) : null;
    }
    if (!input.channelId) return null;
    // A parent channel's footer must not surface work belonging to one of its threads.
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE channel_id=? AND thread_id IS NULL ORDER BY (status='active') DESC, updated_at DESC LIMIT 1").get(input.channelId);
    return row ? asRun(row) : null;
  }
  events(runId: string): AgentRunEvent[] {
    const file = this.readableLogPath(runId); if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as AgentRunEvent);
  }
  timelineForRun(runId: string): { run: AgentRun | null; events: AgentRunEvent[]; usage: AgentRunUsage | null } { const run = this.get(runId); return { run, events: run ? this.events(runId) : [], usage: run ? this.usage(runId, true) : null }; }
  timeline(input: { channelId?: string; threadId?: string }): { run: AgentRun | null; events: AgentRunEvent[]; usage: AgentRunUsage | null } { const run = this.latest(input); return { run, events: run ? this.events(run.run_id) : [], usage: run ? this.usage(run.run_id, true) : null }; }
  append(runId: string, input: { type: AgentRunEventType; tool_call_id?: unknown; action?: unknown; detail?: unknown; status?: unknown; exit_code?: unknown; duration_ms?: unknown; cwd?: unknown }): AgentRun | null {
    const current = this.get(runId); if (!current || current.status !== "active") return null;
    const now = Date.now(); const terminal: Record<string, AgentRunStatus> = { run_finished: "completed", run_failed: "failed", run_aborted: "aborted" };
    const event: AgentRunEvent = { event_id: randomUUID(), run_id: runId, tool_call_id: safeText(input.tool_call_id, 160), type: input.type, action: safeText(input.action, 240), detail: safeText(input.detail), status: safeText(input.status, 80), exit_code: Number.isInteger(input.exit_code) ? input.exit_code as number : null, duration_ms: Number.isFinite(input.duration_ms) ? Math.max(0, Math.floor(input.duration_ms as number)) : null, cwd: safeText(input.cwd, 500), created_at: now };
    const line = JSON.stringify(event) + "\n"; mkdirSync(this.dir(runId), { recursive: true, mode: 0o700 }); appendFileSync(this.logPath(runId), line, { mode: 0o600 });
    const nextStatus = terminal[input.type] ?? "active"; const bytes = current.log_bytes + Buffer.byteLength(line); const hash = createHash("sha256").update(current.log_hash ?? "").update(line).digest("hex");
    this.db.prepare("UPDATE agent_runs SET status=?,current_action=?,updated_at=?,finished_at=?,expires_at=?,log_hash=?,log_event_count=?,log_bytes=? WHERE run_id=?").run(nextStatus,event.action ?? current.current_action,now,nextStatus === "active" ? null : now,nextStatus === "active" ? now+RUN_STALE_AFTER_MS : now,hash,current.log_event_count+1,bytes,runId);
    const result = this.get(runId)!; this.writeManifest(result);
    // Terminal event → tool counts / duration are final; materialize once. Usage
    // may still arrive (agent_end fires just after), refreshStatsUsage handles it.
    // Cost of this read: one full events.jsonl read at run end only — median
    // 13KB (~1ms), worst 1.2MB (~20-40ms), never on the per-event hot path.
    if (nextStatus !== "active") this.materializeStats(runId);
    return result;
  }
  associateMessage(runId: string, assistantMessageId: string): AgentRun | null {
    const run = this.get(runId); if (!run) return null;
    // Idempotent retry: retain first durable final, reject accidental cross-run replacement.
    if (run.assistant_message_id && run.assistant_message_id !== assistantMessageId) return null;
    this.db.prepare("UPDATE agent_runs SET assistant_message_id=?, updated_at=? WHERE run_id=?").run(assistantMessageId, Date.now(), runId);
    const updated = this.get(runId)!; this.writeManifest(updated); return updated;
  }

  /** Record one LLM call's usage against a run. Cost is computed by the caller
   * (price table lives beside the plugin, not in the SQL index). */
  recordUsage(runId: string, input: { provider: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens?: number; cache_write_tokens?: number; cost?: number | null; currency?: string; cost_source?: "provider" | "price_table" | "none" }): void {
    const now = Date.now();
    const total = (input.input_tokens || 0) + (input.output_tokens || 0) + (input.cache_read_tokens || 0) + (input.cache_write_tokens || 0);
    this.db.prepare(`INSERT INTO agent_run_usage (run_id,provider,model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens,cost,currency,cost_source,called_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(runId, input.provider, input.model, input.input_tokens || 0, input.output_tokens || 0, input.cache_read_tokens || 0, input.cache_write_tokens || 0, total, input.cost ?? null, input.currency ?? "USD", input.cost_source ?? "none", now);
    // Usage may arrive after the run reached a terminal state (agent_end hook
    // reports just after run_finished) — refresh the stats row's usage fields.
    // No-op for active runs (they have no row yet; terminal materializes it).
    if (this.get(runId)?.status !== "active") this.refreshStatsUsage(runId);
  }

  /** Aggregate usage for a run, rolling up child/subagent runs when the caller
   * passes `includeChildren` (a parent-run timeline view). */
  usage(runId: string, includeChildren = false): AgentRunUsage | null {
    const run = this.get(runId); if (!run) return null;
    let rows: any[];
    if (includeChildren) {
      // Walk the run's own calls plus any descendant runs. Parent runs are the
      // root of the subagent tree (plugin maps child sessions to the parent run).
      rows = this.db.prepare(`SELECT u.* FROM agent_run_usage u
        WHERE u.run_id IN (SELECT run_id FROM agent_runs WHERE parent_run_id=?
          UNION SELECT ? )`).all(runId, runId);
    } else {
      rows = this.db.prepare("SELECT * FROM agent_run_usage WHERE run_id=?").all(runId);
    }
    return this.aggregateUsageRows(rows);
  }

  /**
   * Aggregate usage across every run in a scope, returning the same
   * `AgentRunUsage` shape as `usage()` so the client reuses existing formatting.
   * Scopes (exactly one):
   *  - `threadId`: all runs in the thread (spans sessions; includes task runs
   *    and child/subagent runs, which inherit the thread scope).
   *  - `taskId`: all runs for the task, across sessions.
   *  - `channelId`: ALL runs anchored to the channel — the parent channel chat
   *    plus every thread. A header placed at channel level reads as "the whole
   *    channel spent X", so it must not be limited to direct runs; the thread
   *    scope exists for per-thread drill-down.
   */
  usageByScope(scope: { threadId?: string; channelId?: string; taskId?: string }): AgentRunUsage | null {
    let rows: any[];
    if (scope.threadId) {
      rows = this.db.prepare(
        `SELECT u.* FROM agent_run_usage u JOIN agent_runs r ON r.run_id = u.run_id WHERE r.thread_id = ?`
      ).all(scope.threadId);
    } else if (scope.taskId) {
      // Task scope is derived through the canonical tasks.thread_id link — the
      // task table is the single source of truth for task↔thread, so runs are
      // matched by their thread, not by a denormalized task_id column.
      rows = this.db.prepare(
        `SELECT u.* FROM agent_run_usage u
         JOIN agent_runs r ON r.run_id = u.run_id
         JOIN tasks t ON t.thread_id = r.thread_id
         WHERE t.task_id = ?`
      ).all(scope.taskId);
    } else if (scope.channelId) {
      // channel_id is the permission/index anchor: direct runs and thread runs
      // both carry the parent channel id (thread runs add thread_id), so one
      // predicate covers the whole channel.
      rows = this.db.prepare(
        `SELECT u.* FROM agent_run_usage u JOIN agent_runs r ON r.run_id = u.run_id WHERE r.channel_id = ?`
      ).all(scope.channelId);
    } else {
      return null;
    }
    return this.aggregateUsageRows(rows);
  }

  /**
   * Per-task usage for every task in a channel that has usage recorded,
   * keyed by task_id. Tasks without usage rows are absent from the map so the
   * client can render an em dash for them. Used by the task table Usage column.
   * Task association is derived via tasks.thread_id (single source of truth).
   */
  usageByTask(channelId: string): Record<string, AgentRunUsage> {
    // Tasks belong to the channel via tasks.channel_id; runs are matched by
    // their thread (the canonical task↔thread link).
    const rows = this.db.prepare(
      `SELECT u.*, t.task_id FROM agent_run_usage u
       JOIN agent_runs r ON r.run_id = u.run_id
       JOIN tasks t ON t.thread_id = r.thread_id
       WHERE t.channel_id = ?`
    ).all(channelId) as any[];
    const byTask = new Map<string, any[]>();
    for (const row of rows) {
      const list = byTask.get(row.task_id) ?? [];
      list.push(row);
      byTask.set(row.task_id, list);
    }
    const out: Record<string, AgentRunUsage> = {};
    for (const [taskId, taskRows] of byTask) {
      const agg = this.aggregateUsageRows(taskRows);
      if (agg) out[taskId] = agg;
    }
    return out;
  }

  /** Shared rollup: totals + cost + per-model breakdown from usage rows. */
  private aggregateUsageRows(rows: any[]): AgentRunUsage | null {
    if (!rows.length) return null;
    const currency = "USD";
    const sum = (k: string) => rows.reduce((acc, r) => acc + (r[k] || 0), 0);
    const costRows = rows.filter((r) => typeof r.cost === "number");
    const cost = costRows.length ? costRows.reduce((acc, r) => acc + (r.cost || 0), 0) : null;
    const cost_source: AgentRunUsage["cost_source"] = cost === null ? "none" : (costRows.some((r) => r.cost_source === "provider") ? "provider" : "price_table");
    const models = new Map<string, { model: string; calls: number; input_tokens: number; output_tokens: number; cost: number | null }>();
    for (const r of rows) {
      const key = r.model;
      const m = models.get(key) ?? { model: key, calls: 0, input_tokens: 0, output_tokens: 0, cost: null };
      m.calls += 1; m.input_tokens += r.input_tokens || 0; m.output_tokens += r.output_tokens || 0;
      if (typeof r.cost === "number") m.cost = (m.cost ?? 0) + r.cost;
      models.set(key, m);
    }
    return {
      calls: rows.length,
      input_tokens: sum("input_tokens"),
      output_tokens: sum("output_tokens"),
      cache_read_tokens: sum("cache_read_tokens"),
      cache_write_tokens: sum("cache_write_tokens"),
      total_tokens: sum("total_tokens"),
      cost, currency, cost_source,
      // Deterministic order regardless of SQLite join plan.
      models: [...models.values()].sort((a, b) => a.model.localeCompare(b.model)),
    };
  }
}
