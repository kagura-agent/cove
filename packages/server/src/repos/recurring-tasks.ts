import type Database from "better-sqlite3";
import { generateSnowflake, type RecurringTask } from "@cove/shared";

interface RecurringTaskRow {
  id: string;
  guild_id: string;
  channel_id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  created_by: string;
  schedule_type: string;
  interval_ms: number;
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
    schedule_type: row.schedule_type as RecurringTask["schedule_type"],
    interval_ms: row.interval_ms,
    enabled: row.enabled === 1,
    last_task_id: row.last_task_id,
    last_spawned_at: row.last_spawned_at,
    heartbeat_interval_ms: row.heartbeat_interval_ms,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class RecurringTasksRepo {
  constructor(private db: Database.Database) {}

  create(params: {
    guild_id: string;
    channel_id: string;
    title: string;
    created_by: string;
    schedule_type: string;
    description?: string;
    assignee_id?: string | null;
    interval_ms?: number;
    heartbeat_interval_ms?: number;
  }): RecurringTask {
    const now = Date.now();
    const id = generateSnowflake();
    const description = params.description ?? "";
    const assigneeId = params.assignee_id ?? null;
    const intervalMs = params.interval_ms ?? 0;
    const heartbeatMs = params.heartbeat_interval_ms ?? 300000;
    this.db.prepare(
      `INSERT INTO recurring_tasks (id, guild_id, channel_id, title, description, assignee_id, created_by, schedule_type, interval_ms, enabled, last_task_id, last_spawned_at, heartbeat_interval_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 0, ?, ?, ?)`
    ).run(id, params.guild_id, params.channel_id, params.title, description, assigneeId, params.created_by, params.schedule_type, intervalMs, heartbeatMs, now, now);
    return {
      id, guild_id: params.guild_id, channel_id: params.channel_id, title: params.title, description,
      assignee_id: assigneeId, created_by: params.created_by,
      schedule_type: params.schedule_type as RecurringTask["schedule_type"],
      interval_ms: intervalMs, enabled: true, last_task_id: null,
      last_spawned_at: 0, heartbeat_interval_ms: heartbeatMs,
      created_at: now, updated_at: now,
    };
  }

  getById(id: string): RecurringTask | null {
    const row = this.db.prepare("SELECT * FROM recurring_tasks WHERE id = ?").get(id) as RecurringTaskRow | undefined;
    return row ? toRecurringTask(row) : null;
  }

  listByChannel(channelId: string): RecurringTask[] {
    const rows = this.db.prepare("SELECT * FROM recurring_tasks WHERE channel_id = ? ORDER BY created_at").all(channelId) as RecurringTaskRow[];
    return rows.map(toRecurringTask);
  }

  listEnabled(): RecurringTask[] {
    const rows = this.db.prepare("SELECT * FROM recurring_tasks WHERE enabled = 1").all() as RecurringTaskRow[];
    return rows.map(toRecurringTask);
  }

  update(id: string, fields: {
    title?: string;
    description?: string;
    assignee_id?: string | null;
    interval_ms?: number;
    enabled?: boolean;
    last_task_id?: string | null;
    last_spawned_at?: number;
    heartbeat_interval_ms?: number;
  }): RecurringTask | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (fields.title !== undefined) { sets.push("title = ?"); values.push(fields.title); }
    if (fields.description !== undefined) { sets.push("description = ?"); values.push(fields.description); }
    if (fields.assignee_id !== undefined) { sets.push("assignee_id = ?"); values.push(fields.assignee_id); }
    if (fields.interval_ms !== undefined) { sets.push("interval_ms = ?"); values.push(fields.interval_ms); }
    if (fields.enabled !== undefined) { sets.push("enabled = ?"); values.push(fields.enabled ? 1 : 0); }
    if (fields.last_task_id !== undefined) { sets.push("last_task_id = ?"); values.push(fields.last_task_id); }
    if (fields.last_spawned_at !== undefined) { sets.push("last_spawned_at = ?"); values.push(fields.last_spawned_at); }
    if (fields.heartbeat_interval_ms !== undefined) { sets.push("heartbeat_interval_ms = ?"); values.push(fields.heartbeat_interval_ms); }

    if (sets.length === 0) return existing;

    const now = Date.now();
    sets.push("updated_at = ?");
    values.push(now);
    values.push(id);

    this.db.prepare(`UPDATE recurring_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM recurring_tasks WHERE id = ?").run(id);
  }
}
