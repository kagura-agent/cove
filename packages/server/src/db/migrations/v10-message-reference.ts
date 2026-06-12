import Database from "better-sqlite3";

export function migrateV9ToV10(db: Database.Database): void {
  db.exec(`
    ALTER TABLE messages ADD COLUMN referenced_message_id TEXT;
  `);
}
