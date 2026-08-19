import type Database from "better-sqlite3";
import { generateSnowflake, type RecurringCatchUp, type RecurringTask, type RecurringTaskOccurrenceMode } from "@cove/shared";
import { DEFAULT_CRON_TZ, nextCronFireTime } from "../services/recurrence-schedule.js";

interface RecurringTaskRow {
  id: string;
  guild_id: string;
  channel_id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  created_by: string;
  interval_ms: number;
  cron_expr: string | null;
  cron_tz: string | null;
  catch_up: string;
  occurrence_mode: string;
  next_run_at: number;
  enabled: number;
  last_task_id: string | null;
  last_spawned_at: number;
  heartbeat_interval_ms: number;
  created_at: number;
  updated_at: number;
}

function toRecurringTask(row: RecurringTaskRow): RecurringTask {
  return {
    id: row.id,
    guild_id: row.guild_id,
    channel_id: row.channel_id,
    title: row.title,
    description: row.description,
    assignee_id: row.assignee_id,
    created_by: row.created_by,
    interval_ms: row.interval_ms,
    cron_expr: row.cron_expr,
    cron_tz: row.cron_tz,
    catch_up: (row.catch_up ?? "skip") as RecurringCatchUp,
    occurrence_mode: row.occurrence_mode as RecurringTaskOccurrenceMode,
    next_run_at: row.next_run_at,
    enabled: row.enabled === 1,
    last_task_id: row.last_task_id,
    last_spawned_at: row.last_spawned_at,
    heartbeat_interval_ms: row.heartbeat_interval_ms,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface CreateRecurringTask {
  guild_id: string;
  channel_id: string;
  title: string;
  created_by: string;
  interval_ms: number;
  cron_expr?: string | null;
  cron_tz?: string | null;
  catch_up?: RecurringCatchUp;
  occurrence_mode?: RecurringTaskOccurrenceMode;
  enabled?: boolean;
  description?: string;
  assignee_id?: string | null;
  heartbeat_interval_ms?: number;
}

export interface UpdateRecurringTask {
  title?: string;
  description?: string;
  assignee_id?: string | null;
  interval_ms?: number;
  cron_expr?: string | null;
  cron_tz?: string | null;
  catch_up?: RecurringCatchUp;
  occurrence_mode?: RecurringTaskOccurrenceMode;
  enabled?: boolean;
  last_task_id?: string | null;
  last_spawned_at?: number;
  next_run_at?: number;
  heartbeat_interval_ms?: number;
}

export class RecurringTasksRepo {
  constructor(private db: Database.Database) {}

  create(params: CreateRecurringTask): RecurringTask {
    const now = Date.now();
    const id = generateSnowflake();
    const description = params.description ?? "";
    const assigneeId = params.assignee_id ?? null;
    const occurrenceMode = params.occurrence_mode ?? "same_task";
    const cronExpr = params.cron_expr ?? null;
    const cronTz = params.cron_tz ?? null;
    const catchUp = params.catch_up ?? "skip";
    const nextRunAt = cronExpr
      ? (nextCronFireTime(cronExpr, cronTz ?? DEFAULT_CRON_TZ, now) ?? now)
      : now + params.interval_ms;
    const enabled = params.enabled ?? true;
    const heartbeatMs = params.heartbeat_interval_ms ?? 0;
    this.db.prepare(
      `INSERT INTO recurring_tasks (id, guild_id, channel_id, title, description, assignee_id, created_by, interval_ms, cron_expr, cron_tz, catch_up, occurrence_mode, next_run_at, enabled, last_task_id, last_spawned_at, heartbeat_interval_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)`
    ).run(id, params.guild_id, params.channel_id, params.title, description, assigneeId, params.created_by, params.interval_ms, cronExpr, cronTz, catchUp, occurrenceMode, nextRunAt, enabled ? 1 : 0, heartbeatMs, now, now);
    return this.getById(id)!;
  }

  getById(id: string): RecurringTask | null {
    const row = this.db.prepare("SELECT * FROM recurring_tasks WHERE id = ?").get(id) as RecurringTaskRow | undefined;
    return row ? toRecurringTask(row) : null;
  }

  listByChannel(channelId: string): RecurringTask[] {
    const rows = this.db.prepare("SELECT * FROM recurring_tasks WHERE channel_id = ? ORDER BY created_at, id").all(channelId) as RecurringTaskRow[];
    return rows.map(toRecurringTask);
  }

  listEnabled(): RecurringTask[] {
    const rows = this.db.prepare("SELECT * FROM recurring_tasks WHERE enabled = 1 ORDER BY created_at, id").all() as RecurringTaskRow[];
    return rows.map(toRecurringTask);
  }

  update(id: string, fields: UpdateRecurringTask): RecurringTask | null {
    const existing = this.getById(id);
    if (!existing) return null;

    // Resolve the effective schedule type after this update.
    // - interval_ms set → interval schedule (clear any lingering cron fields)
    // - cron_expr set → cron schedule (zero interval_ms)
    // - neither set → keep the existing schedule type
    const switchingToInterval = fields.interval_ms !== undefined;
    const switchingToCron = fields.cron_expr !== undefined;
    const wasCron = existing.cron_expr !== null && existing.cron_expr !== undefined && existing.cron_expr.trim() !== "";
    const effectiveCron = switchingToCron ? true : switchingToInterval ? false : wasCron;

    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.title !== undefined) { sets.push("title = ?"); values.push(fields.title); }
    if (fields.description !== undefined) { sets.push("description = ?"); values.push(fields.description); }
    if (fields.assignee_id !== undefined) { sets.push("assignee_id = ?"); values.push(fields.assignee_id); }
    if (fields.interval_ms !== undefined) {
      sets.push("interval_ms = ?");
      values.push(fields.interval_ms);
      if (fields.interval_ms !== existing.interval_ms && fields.next_run_at === undefined) {
        sets.push("next_run_at = ?");
        values.push(Date.now() + fields.interval_ms);
      }
    }
    if (fields.cron_expr !== undefined) { sets.push("cron_expr = ?"); values.push(fields.cron_expr); }
    if (fields.cron_tz !== undefined) { sets.push("cron_tz = ?"); values.push(fields.cron_tz); }
    if (fields.catch_up !== undefined) { sets.push("catch_up = ?"); values.push(fields.catch_up); }

    // Keep the schedule consistent when switching types: a cron schedule
    // clears interval_ms, an interval schedule clears cron fields.
    if (effectiveCron && !switchingToInterval && !wasCron) {
      // interval → cron: zero interval_ms so isCronScheduled wins, and anchor
      // next_run_at at the next real fire time (avoid a stale interval anchor
      // causing an immediate catch-up burst in catch_up=run mode).
      sets.push("interval_ms = ?");
      values.push(0);
      if (fields.next_run_at === undefined && typeof fields.cron_expr === "string") {
        sets.push("next_run_at = ?");
        values.push(
          nextCronFireTime(
            fields.cron_expr,
            fields.cron_tz ?? existing.cron_tz ?? DEFAULT_CRON_TZ,
            Date.now(),
          ) ?? Date.now(),
        );
      }
    }
    if (!effectiveCron && wasCron) {
      // cron → interval: clear cron fields so the template is interval-based.
      sets.push("cron_expr = ?");
      values.push(null);
      sets.push("cron_tz = ?");
      values.push(null);
    }

    if (fields.occurrence_mode !== undefined) { sets.push("occurrence_mode = ?"); values.push(fields.occurrence_mode); }
    if (fields.enabled !== undefined) { sets.push("enabled = ?"); values.push(fields.enabled ? 1 : 0); }
    if (fields.last_task_id !== undefined) { sets.push("last_task_id = ?"); values.push(fields.last_task_id); }
    if (fields.last_spawned_at !== undefined) { sets.push("last_spawned_at = ?"); values.push(fields.last_spawned_at); }
    if (fields.next_run_at !== undefined) { sets.push("next_run_at = ?"); values.push(fields.next_run_at); }
    if (fields.heartbeat_interval_ms !== undefined) { sets.push("heartbeat_interval_ms = ?"); values.push(fields.heartbeat_interval_ms); }
    if (sets.length === 0) return existing;
    sets.push("updated_at = ?");
    values.push(Date.now(), id);
    this.db.prepare(`UPDATE recurring_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM recurring_tasks WHERE id = ?").run(id);
  }
}
