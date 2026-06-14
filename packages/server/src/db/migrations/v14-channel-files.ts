import type Database from "better-sqlite3";

export function migrateV14(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_files (
      channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      filename     TEXT NOT NULL,
      content      TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT 'text/plain',
      size         INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      PRIMARY KEY (channel_id, filename)
    )
  `);
}
