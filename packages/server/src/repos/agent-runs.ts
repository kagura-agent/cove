import type Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentRun, AgentRunEvent, AgentRunEventType, AgentRunStatus } from "@cove/shared";

const MAX_DETAIL = 8_000;
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
  private logPath(runId: string) { return join(this.dir(runId), "events.ndjson"); }
  private writeManifest(run: AgentRun) {
    const dir = this.dir(run.run_id); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const payload = JSON.stringify({ version: 1, run_id: run.run_id, redaction_version: run.redaction_version, event_count: run.log_event_count, bytes: run.log_bytes, hash: run.log_hash, updated_at: run.updated_at }) + "\n";
    const tmp = join(dir, "manifest.json.tmp"); writeFileSync(tmp, payload, { mode: 0o600 }); renameSync(tmp, join(dir, "manifest.json"));
  }
  expire(scope?: { taskId?: string; channelId?: string }) {
    const now = Date.now(); let where = ""; const args: unknown[] = [now, now, now];
    if (scope?.taskId) { where = " AND task_id=?"; args.push(scope.taskId); }
    if (scope?.channelId) { where = " AND channel_id=?"; args.push(scope.channelId); }
    this.db.prepare(`UPDATE agent_runs SET status='stale', finished_at=?, updated_at=? WHERE status='active' AND expires_at < ?${where}`).run(...args);
  }
  start(input: { agent_id: string; channel_id: string; trigger_message_id: string; thread_id?: string | null; task_id?: string | null; parent_run_id?: string | null }): AgentRun {
    this.expire({ channelId: input.channel_id }); const now = Date.now(); const runId = randomUUID();
    // Only task executions are singleton; normal-channel turns may run concurrently.
    if (input.task_id) this.db.prepare("UPDATE agent_runs SET status='stale', finished_at=?, updated_at=? WHERE task_id=? AND status='active'").run(now, now, input.task_id);
    this.db.prepare(`INSERT INTO agent_runs (run_id,agent_id,channel_id,thread_id,task_id,trigger_message_id,assistant_message_id,parent_run_id,status,current_action,started_at,updated_at,finished_at,expires_at,log_manifest_ref,log_hash,log_event_count,log_bytes,redaction_version) VALUES (?,?,?,?,?,?,?,?, 'active',NULL,?,?,NULL,?,'manifest.json',NULL,0,0,1)`).run(runId,input.agent_id,input.channel_id,input.thread_id ?? null,input.task_id ?? null,input.trigger_message_id,null,input.parent_run_id ?? null,now,now,now+90_000);
    const run = this.get(runId)!; this.writeManifest(run); return run;
  }
  get(runId: string): AgentRun | null { const row = this.db.prepare("SELECT * FROM agent_runs WHERE run_id=?").get(runId); return row ? asRun(row) : null; }
  latest(input: { channelId?: string; threadId?: string; taskId?: string }): AgentRun | null {
    this.expire(input.taskId ? { taskId: input.taskId } : input.channelId ? { channelId: input.channelId } : undefined);
    if (input.threadId) {
      const row = this.db.prepare("SELECT * FROM agent_runs WHERE thread_id=? ORDER BY (status='active') DESC, updated_at DESC LIMIT 1").get(input.threadId);
      return row ? asRun(row) : null;
    }
    if (input.taskId) {
      const row = this.db.prepare("SELECT * FROM agent_runs WHERE task_id=? ORDER BY (status='active') DESC, updated_at DESC LIMIT 1").get(input.taskId);
      return row ? asRun(row) : null;
    }
    if (!input.channelId) return null;
    // A parent channel's footer must not surface work belonging to one of its threads.
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE channel_id=? AND thread_id IS NULL ORDER BY (status='active') DESC, updated_at DESC LIMIT 1").get(input.channelId);
    return row ? asRun(row) : null;
  }
  events(runId: string): AgentRunEvent[] {
    const file = this.logPath(runId); if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as AgentRunEvent);
  }
  timelineForRun(runId: string): { run: AgentRun | null; events: AgentRunEvent[] } { const run = this.get(runId); return { run, events: run ? this.events(runId) : [] }; }
  timeline(input: { channelId?: string; threadId?: string; taskId?: string }): { run: AgentRun | null; events: AgentRunEvent[] } { const run = this.latest(input); return { run, events: run ? this.events(run.run_id) : [] }; }
  append(runId: string, input: { type: AgentRunEventType; tool_call_id?: unknown; action?: unknown; detail?: unknown; status?: unknown; exit_code?: unknown; duration_ms?: unknown; cwd?: unknown }): AgentRun | null {
    const current = this.get(runId); if (!current || current.status !== "active") return null;
    const now = Date.now(); const terminal: Record<string, AgentRunStatus> = { run_finished: "completed", run_failed: "failed", run_aborted: "aborted" };
    const event: AgentRunEvent = { event_id: randomUUID(), run_id: runId, tool_call_id: safeText(input.tool_call_id, 160), type: input.type, action: safeText(input.action, 240), detail: safeText(input.detail), status: safeText(input.status, 80), exit_code: Number.isInteger(input.exit_code) ? input.exit_code as number : null, duration_ms: Number.isFinite(input.duration_ms) ? Math.max(0, Math.floor(input.duration_ms as number)) : null, cwd: safeText(input.cwd, 500), created_at: now };
    const line = JSON.stringify(event) + "\n"; mkdirSync(this.dir(runId), { recursive: true, mode: 0o700 }); appendFileSync(this.logPath(runId), line, { mode: 0o600 });
    const nextStatus = terminal[input.type] ?? "active"; const bytes = current.log_bytes + Buffer.byteLength(line); const hash = createHash("sha256").update(current.log_hash ?? "").update(line).digest("hex");
    this.db.prepare("UPDATE agent_runs SET status=?,current_action=?,updated_at=?,finished_at=?,expires_at=?,log_hash=?,log_event_count=?,log_bytes=? WHERE run_id=?").run(nextStatus,event.action ?? current.current_action,now,nextStatus === "active" ? null : now,nextStatus === "active" ? now+90_000 : now,hash,current.log_event_count+1,bytes,runId);
    const result = this.get(runId)!; this.writeManifest(result); return result;
  }
  associateMessage(runId: string, assistantMessageId: string): AgentRun | null {
    const run = this.get(runId); if (!run) return null;
    // Idempotent retry: retain first durable final, reject accidental cross-run replacement.
    if (run.assistant_message_id && run.assistant_message_id !== assistantMessageId) return null;
    this.db.prepare("UPDATE agent_runs SET assistant_message_id=?, updated_at=? WHERE run_id=?").run(assistantMessageId, Date.now(), runId);
    const updated = this.get(runId)!; this.writeManifest(updated); return updated;
  }
}
