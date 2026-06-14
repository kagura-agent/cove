import type Database from "better-sqlite3";

export function migrateV15(db: Database.Database): void {
  db.exec(`
    ALTER TABLE channels ADD COLUMN parent_id TEXT REFERENCES channels(id) ON DELETE CASCADE;
    ALTER TABLE channels ADD COLUMN message_id TEXT;
    ALTER TABLE channels ADD COLUMN thread_metadata TEXT;
    ALTER TABLE channels ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE channels ADD COLUMN member_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE channels ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE channels ADD COLUMN total_message_sent INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS thread_members (
      thread_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      join_timestamp INTEGER NOT NULL,
      PRIMARY KEY (thread_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_thread_members_user ON thread_members(user_id);
  `);
}
