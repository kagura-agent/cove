import type Database from "better-sqlite3";

/**
 * V27 — no-op placeholder.
 *
 * The original v27 (from a closed PR branch) added an `is_task_thread` column
 * to channels. That approach was rejected — task-thread detection now queries
 * the tasks table directly. This migration exists only to keep version
 * numbering sequential. V28 cleans up the column if it was left behind.
 */
export function migrateV27(_db: Database.Database): void {
  // intentionally empty
}
