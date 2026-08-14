import type Database from "better-sqlite3";

/**
 * Index tasks.thread_id.
 *
 * thread_id is the canonical task↔thread link used by task-scoped usage
 * aggregates (JOIN tasks ON tasks.thread_id = agent_runs.thread_id) and the
 * by-thread lookup (GET /tasks/by-thread/:threadId). Without an index those
 * queries scan the table; data is small today but the aggregate runs on every
 * Tasks tab load.
 */
export function migrateV38(db: Database.Database): void {
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_thread_id ON tasks(thread_id)");
}
