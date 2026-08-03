import type Database from "better-sqlite3";

export function migrateV27(db: Database.Database): void {
  // Add is_task_thread flag — may already exist if DB was created with latest schema
  const cols = db.prepare("PRAGMA table_info(channels)").all() as Array<{ name: string }>;
  if (!cols.some(c => c.name === "is_task_thread")) {
    db.exec(`ALTER TABLE channels ADD COLUMN is_task_thread INTEGER NOT NULL DEFAULT 0`);
  }
  db.exec(`UPDATE channels SET is_task_thread = 1 WHERE id IN (SELECT thread_id FROM tasks)`);
}
