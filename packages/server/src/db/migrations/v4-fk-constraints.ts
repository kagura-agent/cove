import Database from "better-sqlite3";
import { tableExists, addColumnIfMissing } from "./util.js";

export function migrateV3ToV4(db: Database.Database): void {
  // #207: Add google_id and email columns to users table
  // SQLite doesn't allow ALTER TABLE ADD COLUMN with UNIQUE constraint,
  // so we add the column plain and create a unique index separately.
  addColumnIfMissing(db, "users", "google_id", "TEXT");
  addColumnIfMissing(db, "users", "email", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)");

  // #205: Recreate tables with proper FK constraints and NOT NULL
  // SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so we use the recreate pattern.
  const rowCount = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;

  // Recreate messages table with proper constraints
  if (tableExists(db, "messages")) {
    const beforeCount = rowCount("messages");
    // Legacy schema used 'author_id' instead of 'sender'
    const cols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    const senderCol = colNames.includes("sender") ? "sender" : colNames.includes("author_id") ? "author_id" : "NULL";
    const senderNameCol = colNames.includes("sender_name") ? "sender_name" : "NULL";
    const metadataCol = colNames.includes("metadata") ? "metadata" : "NULL";
    const editedCol = colNames.includes("edited_timestamp") ? "edited_timestamp" : "NULL";

    db.exec(`
      CREATE TABLE messages_new (
        id               TEXT PRIMARY KEY,
        channel_id       TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        sender           TEXT REFERENCES users(id) ON DELETE SET NULL,
        content          TEXT NOT NULL,
        timestamp        INTEGER NOT NULL,
        metadata         TEXT,
        edited_timestamp INTEGER,
        sender_name      TEXT
      )
    `);
    db.exec(`
      INSERT INTO messages_new (id, channel_id, sender, content, timestamp, metadata, edited_timestamp, sender_name)
      SELECT id, channel_id,
        CASE WHEN ${senderCol} IN (SELECT id FROM users) THEN ${senderCol} ELSE NULL END,
        COALESCE(content, ''),
        COALESCE(timestamp, 0),
        ${metadataCol}, ${editedCol}, ${senderNameCol}
      FROM messages
      WHERE channel_id IS NOT NULL
    `);
    db.exec("DROP TABLE messages");
    db.exec("ALTER TABLE messages_new RENAME TO messages");
    const afterCount = rowCount("messages");
    console.log(`Migration: messages ${beforeCount} → ${afterCount} (${beforeCount - afterCount} orphans removed)`);
  }

  // Recreate channels table with ON DELETE CASCADE
  if (tableExists(db, "channels")) {
    const beforeCount = rowCount("channels");
    db.exec(`
      CREATE TABLE channels_new (
        id          TEXT PRIMARY KEY,
        guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        type        INTEGER NOT NULL DEFAULT 0,
        topic       TEXT,
        position    INTEGER NOT NULL DEFAULT 0
      )
    `);
    db.exec(`
      INSERT INTO channels_new (id, guild_id, name, type, topic, position)
      SELECT id, guild_id, name, type, topic, position
      FROM channels
      WHERE guild_id IN (SELECT id FROM guilds)
    `);
    db.exec("DROP TABLE channels");
    db.exec("ALTER TABLE channels_new RENAME TO channels");
    const afterCount = rowCount("channels");
    console.log(`Migration: channels ${beforeCount} → ${afterCount} (${beforeCount - afterCount} orphans removed)`);
  }

  // Recreate read_states with FK constraints
  if (tableExists(db, "read_states")) {
    const beforeCount = rowCount("read_states");
    db.exec(`
      CREATE TABLE read_states_new (
        user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id           TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        last_read_message_id TEXT,
        PRIMARY KEY (user_id, channel_id)
      )
    `);
    db.exec(`
      INSERT INTO read_states_new (user_id, channel_id, last_read_message_id)
      SELECT user_id, channel_id, last_read_message_id
      FROM read_states
      WHERE user_id IN (SELECT id FROM users)
        AND channel_id IN (SELECT id FROM channels)
    `);
    db.exec("DROP TABLE read_states");
    db.exec("ALTER TABLE read_states_new RENAME TO read_states");
    const afterCount = rowCount("read_states");
    console.log(`Migration: read_states ${beforeCount} → ${afterCount} (${beforeCount - afterCount} orphans removed)`);
  }

  // #204: Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_guild_members_user_id ON guild_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_channels_guild_pos ON channels(guild_id, position);
  `);
}
