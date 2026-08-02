import type Database from "better-sqlite3";

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some(c => c.name === column);
}

export function migrateV26(db: Database.Database): void {
  if (!hasColumn(db, "tasks", "guild_id")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''`);
  }
  if (!hasColumn(db, "tasks", "description")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
  }
  if (!hasColumn(db, "tasks", "created_by")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN created_by TEXT NOT NULL DEFAULT ''`);
  }
  if (!hasColumn(db, "tasks", "heartbeat_interval_ms")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN heartbeat_interval_ms INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, "tasks", "heartbeat_last_at")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN heartbeat_last_at INTEGER NOT NULL DEFAULT 0`);
  }

  // Backfill guild_id from channels table
  db.exec(`UPDATE tasks SET guild_id = (SELECT guild_id FROM channels WHERE channels.id = tasks.channel_id) WHERE guild_id = ''`);
  // Backfill created_by from messages table
  db.exec(`UPDATE tasks SET created_by = (SELECT sender FROM messages WHERE messages.id = tasks.message_id) WHERE created_by = ''`);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_guild_id ON tasks(guild_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id)`);

  // NOTE: thread_id and message_id should be nullable in a future schema redesign.
  // SQLite cannot ALTER column constraints, and our creation flow always provides values,
  // so they remain NOT NULL for now.
}
