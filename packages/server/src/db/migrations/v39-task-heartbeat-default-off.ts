import type Database from "better-sqlite3";

/**
 * Task heartbeat is opt-in (see #559): assignment alone never enables it,
 * and when enabled the default interval is 1h instead of 5min.
 *
 * SQLite can't alter a column default in place — rebuild recurring_tasks
 * with DEFAULT 0 for heartbeat_interval_ms. Existing rows keep their values.
 */
export function migrateV39(db: Database.Database): void {
  const tableInfo = db.prepare("PRAGMA table_info(recurring_tasks)").all() as { name: string; dflt_value: string | null }[];
  const current = tableInfo.find((col) => col.name === "heartbeat_interval_ms");
  if (!current || current.dflt_value === "0") return;

  // Called inside runMigrations' transaction — no BEGIN/COMMIT here.
  db.exec(`
    ALTER TABLE recurring_tasks RENAME TO recurring_tasks_old;
    CREATE TABLE recurring_tasks (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assignee_id TEXT,
      created_by TEXT NOT NULL,
      interval_ms INTEGER NOT NULL,
      occurrence_mode TEXT NOT NULL DEFAULT 'same_task',
      next_run_at INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_task_id TEXT,
      last_spawned_at INTEGER NOT NULL DEFAULT 0,
      heartbeat_interval_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO recurring_tasks (id, guild_id, channel_id, title, description, assignee_id, created_by, interval_ms, occurrence_mode, next_run_at, enabled, last_task_id, last_spawned_at, heartbeat_interval_ms, created_at, updated_at)
      SELECT id, guild_id, channel_id, title, description, assignee_id, created_by, interval_ms, occurrence_mode, next_run_at, enabled, last_task_id, last_spawned_at, heartbeat_interval_ms, created_at, updated_at FROM recurring_tasks_old;
    DROP TABLE recurring_tasks_old;
  `);
}
