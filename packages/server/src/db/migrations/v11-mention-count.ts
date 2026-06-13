import type Database from "better-sqlite3";
import { tableExists } from "./util.js";

export function migrateV11(db: Database.Database): void {
  if (!tableExists(db, "read_states")) return;

  // Add mention_count column (default 0) to track unread mentions per channel per user
  const cols = db.prepare("PRAGMA table_info(read_states)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "mention_count")) {
    db.exec("ALTER TABLE read_states ADD COLUMN mention_count INTEGER NOT NULL DEFAULT 0");
  }
}
