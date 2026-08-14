import type Database from "better-sqlite3";

/**
 * Drop the denormalized agent_runs.task_id column.
 *
 * Task↔thread is canonical in the tasks table (thread_id NOT NULL, 1:1 in
 * practice), and every run anchored to a task thread already carries the
 * thread_id. All task-scoped aggregates derive the association via
 * `JOIN tasks ON tasks.thread_id = agent_runs.thread_id` — the task_id column
 * was never populated by the plugin and is now dead weight (plus its index).
 *
 * Per-task run singleton is covered by the per-thread singleton: a task owns
 * exactly one thread, so `latest`/`expire` scoped by thread is equivalent.
 */
export function migrateV36(db: Database.Database): void {
  // Defensive: on re-runs the column may already be gone (idempotent upgrade).
  const cols = db.prepare("PRAGMA table_info(agent_runs)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "task_id")) return;
  db.exec(`
    DROP INDEX IF EXISTS idx_agent_runs_task_updated;
    ALTER TABLE agent_runs DROP COLUMN task_id;
  `);
}
