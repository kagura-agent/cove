import type Database from "better-sqlite3";

/**
 * V28 — clean up `is_task_thread` column from channels table.
 *
 * A closed PR branch (v27) added this column to channels. The approach was
 * rejected: task-thread detection now queries the tasks table by thread_id
 * instead. This migration drops the orphaned column if it exists.
 */
export function migrateV28(db: Database.Database): void {
  const columns = db.pragma("table_info(channels)") as Array<{ name: string }>;
  const hasColumn = columns.some((c) => c.name === "is_task_thread");
  if (hasColumn) {
    db.exec("ALTER TABLE channels DROP COLUMN is_task_thread");
  }
}
