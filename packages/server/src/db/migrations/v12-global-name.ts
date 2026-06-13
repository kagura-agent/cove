import type Database from "better-sqlite3";
import { tableExists } from "./util.js";

export function migrateV12(db: Database.Database): void {
  if (!tableExists(db, "users")) return;

  const cols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "global_name")) {
    db.exec("ALTER TABLE users ADD COLUMN global_name TEXT DEFAULT NULL");
  }
}
