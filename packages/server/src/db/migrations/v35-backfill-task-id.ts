import type Database from "better-sqlite3";

/**
 * Backfill agent_runs.task_id from the tasks table.
 *
 * Before this migration, runs anchored to a task thread were created without a
 * task_id (the plugin only passed channel_id/thread_id), so per-task usage
 * aggregates (task table Usage column) could never match them. Every run whose
 * thread_id belongs to a task is re-pointed at that task.
 */
export function migrateV35(db: Database.Database): void {
  db.exec(`
    UPDATE agent_runs
    SET task_id = (
      SELECT tasks.task_id FROM tasks WHERE tasks.thread_id = agent_runs.thread_id
    )
    WHERE agent_runs.thread_id IS NOT NULL
      AND agent_runs.task_id IS NULL
      AND EXISTS (
        SELECT 1 FROM tasks WHERE tasks.thread_id = agent_runs.thread_id
      );
  `);
}
