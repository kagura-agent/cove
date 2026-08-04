import type Database from "better-sqlite3";

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

export function migrateV30(db: Database.Database): void {
  if (!hasColumn(db, "recurring_tasks", "occurrence_mode")) {
    db.exec("ALTER TABLE recurring_tasks ADD COLUMN occurrence_mode TEXT NOT NULL DEFAULT 'new_task'");
  }
}
