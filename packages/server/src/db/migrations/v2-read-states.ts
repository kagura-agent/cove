import Database from "better-sqlite3";

export function migrateV1ToV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS read_states (
      user_id              TEXT NOT NULL,
      channel_id           TEXT NOT NULL,
      last_read_message_id TEXT,
      PRIMARY KEY (user_id, channel_id)
    )
  `);
}
