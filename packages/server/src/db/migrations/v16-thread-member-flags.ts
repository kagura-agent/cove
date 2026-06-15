import type Database from "better-sqlite3";

export function migrateV16(db: Database.Database): void {
  const columns = db.pragma("table_info(thread_members)") as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "flags")) {
    db.exec("ALTER TABLE thread_members ADD COLUMN flags INTEGER NOT NULL DEFAULT 0");
  }
}
