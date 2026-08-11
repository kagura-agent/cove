import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TaskRun, TaskRunEvent, TaskRunEventType, TaskRunStatus } from "@cove/shared";

const MAX_EVENTS_PER_RUN = 100;
const MAX_TEXT = 2_000;
const BEARER = /(authorization\s*[:=]\s*bearer\s+|bearer\s+)([^\s'"`]+)/gi;
const SECRET = /((?:api[_-]?key|token|secret|password|cookie)\s*[:=]\s*)([^\s'"`]+)/gi;
const ENV_VALUE = /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)\s*=\s*[^\s]+/g;

function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const redacted = value.replace(BEARER, "$1[REDACTED]").replace(SECRET, "$1[REDACTED]").replace(ENV_VALUE, (match) => match.replace(/=.*/, "=[REDACTED]"));
  return redacted.length > max ? `${redacted.slice(0, max)}… [${redacted.length - max} bytes omitted]` : redacted;
}
function run(row: any): TaskRun { return row as TaskRun; }
function event(row: any): TaskRunEvent { return row as TaskRunEvent; }

export class TaskRunsRepo {
  constructor(private db: Database.Database) {}
  expire(taskId?: string): void {
    const now = Date.now();
    const where = taskId ? "task_id = ? AND" : "";
    const args = taskId ? [now, now, taskId, now] : [now, now];
    this.db.prepare(`UPDATE task_runs SET status='stale', finished_at=?, updated_at=? WHERE ${where} status='active' AND expires_at < ?`).run(...args);
  }
  start(taskId: string, agentId: string): TaskRun {
    this.expire(taskId);
    const now = Date.now(); const runId = randomUUID();
    // A newer canonical run supersedes a lingering active run for the same task.
    this.db.prepare("UPDATE task_runs SET status='stale', finished_at=?, updated_at=? WHERE task_id=? AND status='active'").run(now, now, taskId);
    this.db.prepare("INSERT INTO task_runs (run_id,task_id,agent_id,status,current_action,started_at,updated_at,finished_at,expires_at) VALUES (?,?,?,'active',NULL,?,?,NULL,?)").run(runId, taskId, agentId, now, now, now + 90_000);
    return this.get(runId)!;
  }
  get(runId: string): TaskRun | null { const row = this.db.prepare("SELECT * FROM task_runs WHERE run_id=?").get(runId); return row ? run(row) : null; }
  timeline(taskId: string): { run: TaskRun | null; events: TaskRunEvent[] } {
    this.expire(taskId);
    const active = this.db.prepare("SELECT * FROM task_runs WHERE task_id=? ORDER BY (status='active') DESC, updated_at DESC LIMIT 1").get(taskId);
    if (!active) return { run: null, events: [] };
    const events = this.db.prepare("SELECT * FROM task_run_events WHERE run_id=? ORDER BY created_at ASC, rowid ASC LIMIT ?").all((active as any).run_id, MAX_EVENTS_PER_RUN).map(event);
    return { run: run(active), events };
  }
  append(taskId: string, runId: string, input: { type: TaskRunEventType; tool_call_id?: unknown; action?: unknown; detail?: unknown; status?: unknown; exit_code?: unknown; duration_ms?: unknown; cwd?: unknown }): TaskRun | null {
    const current = this.get(runId);
    if (!current || current.task_id !== taskId || current.status !== "active") return null;
    const now = Date.now();
    const terminal: Record<string, TaskRunStatus> = { run_finished: "completed", run_failed: "failed", run_aborted: "aborted" };
    const nextStatus = terminal[input.type] ?? "active";
    const action = text(input.action, 240);
    this.db.prepare("INSERT INTO task_run_events (event_id,task_id,run_id,tool_call_id,type,action,detail,status,exit_code,duration_ms,cwd,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), taskId, runId, text(input.tool_call_id, 160), input.type, action, text(input.detail), text(input.status, 80), Number.isInteger(input.exit_code) ? input.exit_code : null, Number.isFinite(input.duration_ms) ? Math.max(0, Math.floor(input.duration_ms as number)) : null, text(input.cwd, 500), now);
    this.db.prepare("DELETE FROM task_run_events WHERE run_id=? AND event_id NOT IN (SELECT event_id FROM task_run_events WHERE run_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?)").run(runId, runId, MAX_EVENTS_PER_RUN);
    this.db.prepare("UPDATE task_runs SET status=?, current_action=?, updated_at=?, finished_at=?, expires_at=? WHERE run_id=?").run(nextStatus, action ?? current.current_action, now, nextStatus === "active" ? null : now, nextStatus === "active" ? now + 90_000 : now, runId);
    return this.get(runId);
  }
}
