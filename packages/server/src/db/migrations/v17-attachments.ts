import type Database from "better-sqlite3";
import { tableExists } from "./util.js";

export function migrateV17(db: Database.Database): void {
  if (!tableExists(db, "messages")) return;

  // Add attachments column (TEXT JSON) to store attachment metadata
  const cols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "attachments")) {
    db.exec("ALTER TABLE messages ADD COLUMN attachments TEXT DEFAULT '[]'");
  }
}
