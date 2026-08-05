import type Database from "better-sqlite3";
import { hasColumn } from "./util.js";

export function migrateV31(db: Database.Database): void {
  if (!hasColumn(db, "recurring_tasks", "schedule_type")) {
    if (!hasColumn(db, "recurring_tasks", "next_run_at")) {
      db.exec("ALTER TABLE recurring_tasks ADD COLUMN next_run_at INTEGER NOT NULL DEFAULT 0");
    }
    return;
  }

  db.exec(`
    ALTER TABLE recurring_tasks RENAME TO recurring_tasks_v30;
    CREATE TABLE recurring_tasks (
      id                      TEXT PRIMARY KEY,
      guild_id                TEXT NOT NULL,
      channel_id              TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      title                   TEXT NOT NULL,
      description             TEXT NOT NULL DEFAULT '',
      assignee_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_by              TEXT NOT NULL,
      interval_ms             INTEGER NOT NULL,
      occurrence_mode         TEXT NOT NULL DEFAULT 'same_task',
      next_run_at             INTEGER NOT NULL DEFAULT 0,
      enabled                 INTEGER NOT NULL DEFAULT 1,
      last_task_id            TEXT,
      last_spawned_at         INTEGER NOT NULL DEFAULT 0,
      heartbeat_interval_ms   INTEGER NOT NULL DEFAULT 300000,
      created_at              INTEGER NOT NULL,
      updated_at              INTEGER NOT NULL
    );
    INSERT INTO recurring_tasks (id, guild_id, channel_id, title, description, assignee_id, created_by, interval_ms, occurrence_mode, next_run_at, enabled, last_task_id, last_spawned_at, heartbeat_interval_ms, created_at, updated_at)
    SELECT id, guild_id, channel_id, title, description, assignee_id, created_by, interval_ms, occurrence_mode,
      CASE WHEN schedule_type = 'interval' AND interval_ms > 0 THEN updated_at + interval_ms ELSE 0 END,
      enabled, last_task_id, last_spawned_at, heartbeat_interval_ms, created_at, updated_at
    FROM recurring_tasks_v30;
    DROP TABLE recurring_tasks_v30;
    CREATE INDEX IF NOT EXISTS idx_recurring_tasks_channel ON recurring_tasks(channel_id);
    CREATE INDEX IF NOT EXISTS idx_recurring_tasks_guild ON recurring_tasks(guild_id);
  `);
}
