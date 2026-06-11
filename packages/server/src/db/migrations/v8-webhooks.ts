import Database from "better-sqlite3";

export function migrateV7ToV8(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      avatar      TEXT,
      token       TEXT UNIQUE NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_webhooks_channel_id ON webhooks(channel_id);
    CREATE INDEX IF NOT EXISTS idx_webhooks_guild_id ON webhooks(guild_id);

    ALTER TABLE messages ADD COLUMN webhook_id TEXT REFERENCES webhooks(id) ON DELETE SET NULL;
  `);
}
