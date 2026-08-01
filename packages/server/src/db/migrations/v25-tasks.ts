import type Database from "better-sqlite3";

export function migrateV25(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id       TEXT PRIMARY KEY,
      channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      thread_id     TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      status        TEXT NOT NULL DEFAULT 'open',
      assignee_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
      title         TEXT NOT NULL,
      seq           INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_channel_id ON tasks(channel_id)");
}
