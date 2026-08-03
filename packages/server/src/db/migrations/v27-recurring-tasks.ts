import type Database from "better-sqlite3";

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some(c => c.name === column);
}

export function migrateV27(db: Database.Database): void {
  // New table: recurring task templates
  db.exec(`
    CREATE TABLE IF NOT EXISTS recurring_tasks (
      id              TEXT PRIMARY KEY,
      guild_id        TEXT NOT NULL,
      channel_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      assignee_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_by      TEXT NOT NULL,
      schedule_type   TEXT NOT NULL,
      interval_ms     INTEGER NOT NULL DEFAULT 0,
      enabled         INTEGER NOT NULL DEFAULT 1,
      last_task_id    TEXT,
      last_spawned_at INTEGER NOT NULL DEFAULT 0,
      heartbeat_interval_ms INTEGER NOT NULL DEFAULT 300000,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_recurring_tasks_channel ON recurring_tasks(channel_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_recurring_tasks_guild ON recurring_tasks(guild_id)");

  // Extend tasks table with recurring task reference
  if (!hasColumn(db, "tasks", "recurring_id")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN recurring_id TEXT DEFAULT NULL`);
  }
  if (!hasColumn(db, "tasks", "recurring_seq")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN recurring_seq INTEGER NOT NULL DEFAULT 0`);
  }
}
