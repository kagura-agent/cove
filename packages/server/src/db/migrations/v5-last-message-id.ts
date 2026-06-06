import Database from "better-sqlite3";
import { addColumnIfMissing } from "./util.js";

export function migrateV4ToV5(db: Database.Database): void {
  // #198: Add last_message_id column to channels table
  addColumnIfMissing(db, "channels", "last_message_id", "TEXT");

  // Backfill last_message_id from existing messages
  db.exec(`
    UPDATE channels SET last_message_id = (
      SELECT m.id FROM messages m WHERE m.channel_id = channels.id ORDER BY m.id DESC LIMIT 1
    )
  `);
}
