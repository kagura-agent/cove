import Database from "better-sqlite3";

export function migrateV8ToV9(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_permission_overwrites (
      channel_id   TEXT NOT NULL,
      target_id    TEXT NOT NULL,
      target_type  INTEGER NOT NULL DEFAULT 1,
      allow        TEXT NOT NULL DEFAULT '0',
      deny         TEXT NOT NULL DEFAULT '0',
      PRIMARY KEY (channel_id, target_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );
  `);
}
