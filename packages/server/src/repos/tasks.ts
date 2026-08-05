import type Database from "better-sqlite3";
import { type Task, type TaskRecurrence } from "@cove/shared";

interface TaskRow {
  task_id: string;
  channel_id: string;
  thread_id: string;
  message_id: string;
  status: string;
  assignee_id: string | null;
  title: string;
  seq: number;
  guild_id: string;
  description: string;
  created_by: string;
  heartbeat_interval_ms: number;
  heartbeat_last_at: number;
  recurring_id: string | null;
  recurring_seq: number;
  created_at: number;
  updated_at: number;
  recurrence_id: string | null;
  recurrence_root_task_id: string | null;
  recurrence_interval_ms: number | null;
  recurrence_occurrence_mode: string | null;
  recurrence_next_run_at: number | null;
  recurrence_enabled: number | null;
  recurrence_last_task_id: string | null;
  recurrence_last_spawned_at: number | null;
}

const TASK_SELECT = `
  SELECT t.*,
    rt.id AS recurrence_id,
    root_task.task_id AS recurrence_root_task_id,
    rt.interval_ms AS recurrence_interval_ms,
    rt.occurrence_mode AS recurrence_occurrence_mode,
    rt.next_run_at AS recurrence_next_run_at,
    rt.enabled AS recurrence_enabled,
    rt.last_task_id AS recurrence_last_task_id,
    rt.last_spawned_at AS recurrence_last_spawned_at
  FROM tasks t
  LEFT JOIN recurring_tasks rt ON rt.id = t.recurring_id
  LEFT JOIN tasks root_task ON root_task.recurring_id = rt.id AND root_task.recurring_seq = 1
`;

function toTask(row: TaskRow): Task {
  const recurrence: TaskRecurrence | undefined = row.recurrence_id === null ? undefined : {
    root_task_id: row.recurrence_root_task_id!,
    id: row.recurrence_id,
    interval_ms: row.recurrence_interval_ms!,
    occurrence_mode: row.recurrence_occurrence_mode as TaskRecurrence["occurrence_mode"],
    next_run_at: row.recurrence_next_run_at!,
    enabled: row.recurrence_enabled === 1,
    last_task_id: row.recurrence_last_task_id,
    last_spawned_at: row.recurrence_last_spawned_at!,
  };
  return {
    task_id: row.task_id,
    channel_id: row.channel_id,
    thread_id: row.thread_id,
    message_id: row.message_id,
    status: row.status as Task["status"],
    assignee_id: row.assignee_id,
    title: row.title,
    seq: row.seq,
    guild_id: row.guild_id,
    description: row.description,
    created_by: row.created_by,
    heartbeat_interval_ms: row.heartbeat_interval_ms,
    heartbeat_last_at: row.heartbeat_last_at,
    recurring_id: row.recurring_id,
    recurring_seq: row.recurring_seq,
    ...(recurrence ? { recurrence } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class TasksRepo {
  constructor(private db: Database.Database) {}

  create(taskId: string, channelId: string, threadId: string, messageId: string, assigneeId: string | null, title: string, seq: number, opts?: { guild_id?: string; description?: string; created_by?: string; recurring_id?: string | null; recurring_seq?: number }): Task {
    const now = Date.now();
    const guildId = opts?.guild_id ?? "";
    const description = opts?.description ?? "";
    const createdBy = opts?.created_by ?? "";
    const recurringId = opts?.recurring_id ?? null;
    const recurringSeq = opts?.recurring_seq ?? 0;
    this.db.prepare(
      "INSERT INTO tasks (task_id, channel_id, thread_id, message_id, status, assignee_id, title, seq, guild_id, description, created_by, heartbeat_interval_ms, heartbeat_last_at, recurring_id, recurring_seq, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)"
    ).run(taskId, channelId, threadId, messageId, assigneeId, title, seq, guildId, description, createdBy, recurringId, recurringSeq, now, now);
    return this.getById(taskId)!;
  }

  getById(taskId: string): Task | null {
    const row = this.db.prepare(`${TASK_SELECT} WHERE t.task_id = ?`).get(taskId) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  listByChannel(channelId: string): Task[] {
    const rows = this.db.prepare(`${TASK_SELECT} WHERE t.channel_id = ? ORDER BY t.seq`).all(channelId) as TaskRow[];
    return rows.map(toTask);
  }

  listByRecurringId(recurringId: string): Task[] {
    const rows = this.db.prepare(`${TASK_SELECT} WHERE t.recurring_id = ? ORDER BY t.seq`).all(recurringId) as TaskRow[];
    return rows.map(toTask);
  }

  update(taskId: string, fields: { status?: string; assignee_id?: string | null; title?: string; description?: string; heartbeat_interval_ms?: number; heartbeat_last_at?: number }): Task | null {
    const task = this.getById(taskId);
    if (!task) return null;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (fields.status !== undefined) { sets.push("status = ?"); values.push(fields.status); }
    if (fields.assignee_id !== undefined) { sets.push("assignee_id = ?"); values.push(fields.assignee_id); }
    if (fields.title !== undefined) { sets.push("title = ?"); values.push(fields.title); }
    if (fields.description !== undefined) { sets.push("description = ?"); values.push(fields.description); }
    if (fields.heartbeat_interval_ms !== undefined) { sets.push("heartbeat_interval_ms = ?"); values.push(fields.heartbeat_interval_ms); }
    if (fields.heartbeat_last_at !== undefined) { sets.push("heartbeat_last_at = ?"); values.push(fields.heartbeat_last_at); }

    if (sets.length === 0) return task;

    const now = Date.now();
    sets.push("updated_at = ?");
    values.push(now);
    values.push(taskId);

    this.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE task_id = ?`).run(...values);
    return this.getById(taskId);
  }

  associateRecurrence(taskId: string, recurringId: string): Task | null {
    this.db.prepare("UPDATE tasks SET recurring_id = ?, recurring_seq = 1, updated_at = ? WHERE task_id = ?").run(recurringId, Date.now(), taskId);
    return this.getById(taskId);
  }

  getByThreadId(threadId: string): Task | null {
    const row = this.db.prepare(`${TASK_SELECT} WHERE t.thread_id = ?`).get(threadId) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  getByMessageId(messageId: string): Task | null {
    const row = this.db.prepare(`${TASK_SELECT} WHERE t.message_id = ?`).get(messageId) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  listDueForHeartbeat(): Task[] {
    const now = Date.now();
    const rows = this.db.prepare(
      `${TASK_SELECT} WHERE t.heartbeat_interval_ms > 0 AND t.thread_id IS NOT NULL AND t.thread_id != '' AND t.status NOT IN ('done', 'cancelled') AND (t.heartbeat_last_at + t.heartbeat_interval_ms) <= ?`
    ).all(now) as TaskRow[];
    return rows.map(toTask);
  }

  getNextSeq(channelId: string): number {
    const row = this.db.prepare("SELECT MAX(seq) as max_seq FROM tasks WHERE channel_id = ?").get(channelId) as { max_seq: number | null } | undefined;
    return (row?.max_seq ?? 0) + 1;
  }

  clearRecurrenceAssociation(recurringId: string): void {
    this.db.prepare("UPDATE tasks SET recurring_id = NULL, recurring_seq = 0, updated_at = ? WHERE recurring_id = ?").run(Date.now(), recurringId);
  }

  delete(taskId: string): void {
    this.db.prepare("DELETE FROM tasks WHERE task_id = ?").run(taskId);
  }
}
