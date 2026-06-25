import Database from "better-sqlite3";
import { generateSnowflake, DEFAULT_EVERYONE_PERMISSIONS } from "@cove/shared";
import { runMigrations } from "./migrations/index.js";

export function createAllTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guilds (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      icon        TEXT,
      owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channels (
      id               TEXT PRIMARY KEY,
      guild_id         TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      type             INTEGER NOT NULL DEFAULT 0,
      topic            TEXT,
      position         INTEGER NOT NULL DEFAULT 0,
      last_message_id  TEXT,
      parent_id        TEXT REFERENCES channels(id) ON DELETE CASCADE,
      message_id       TEXT,
      thread_metadata  TEXT,
      message_count    INTEGER NOT NULL DEFAULT 0,
      member_count     INTEGER NOT NULL DEFAULT 0,
      owner_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
      total_message_sent INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT NOT NULL,
      avatar      TEXT,
      bot         INTEGER NOT NULL DEFAULT 1,
      bio         TEXT,
      global_name TEXT,
      token       TEXT UNIQUE,
      google_id   TEXT UNIQUE,
      email       TEXT UNIQUE,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      expires_at  INTEGER DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS guild_members (
      guild_id    TEXT NOT NULL REFERENCES guilds(id),
      user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
      nick        TEXT,
      roles       TEXT DEFAULT '[]',
      joined_at   INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id               TEXT PRIMARY KEY,
      channel_id       TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      sender           TEXT REFERENCES users(id) ON DELETE SET NULL,
      content          TEXT NOT NULL,
      timestamp        INTEGER NOT NULL,
      metadata         TEXT,
      edited_timestamp INTEGER,
      sender_name      TEXT
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id         TEXT PRIMARY KEY,
      code       TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL,
      used_at    INTEGER,
      used_by    TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pending_registrations (
      id            TEXT PRIMARY KEY,
      pending_token TEXT UNIQUE NOT NULL,
      google_id     TEXT,
      email         TEXT,
      username      TEXT,
      avatar        TEXT,
      global_name   TEXT,
      created_at    INTEGER
    );

    CREATE TABLE IF NOT EXISTS read_states (
      user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_id           TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      last_read_message_id TEXT,
      mention_count        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, user_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON reactions(message_id);

    CREATE TABLE IF NOT EXISTS channel_files (
      channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      filename     TEXT NOT NULL,
      content      TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT 'text/plain',
      size         INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      PRIMARY KEY (channel_id, filename)
    );

    CREATE TABLE IF NOT EXISTS channel_permission_overwrites (
      channel_id   TEXT NOT NULL,
      target_id    TEXT NOT NULL,
      target_type  INTEGER NOT NULL DEFAULT 1,
      allow        TEXT NOT NULL DEFAULT '0',
      deny         TEXT NOT NULL DEFAULT '0',
      PRIMARY KEY (channel_id, target_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS thread_members (
      thread_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      join_timestamp INTEGER NOT NULL,
      flags          INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (thread_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_thread_members_user ON thread_members(user_id);
  `);
}

export function initDb(dbPath: string = ":memory:"): Database.Database {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");

  // FK must be OFF during migrations — SQLite silently ignores
  // PRAGMA foreign_keys changes inside transactions.
  db.pragma("foreign_keys = OFF");
  runMigrations(db);
  db.pragma("foreign_keys = ON");

  // Verify no orphaned FK references after migration
  const fkViolations = db.pragma("foreign_key_check") as unknown[];
  if (fkViolations.length > 0) {
    throw new Error(`Foreign key violations detected after migration: ${JSON.stringify(fkViolations)}`);
  }

  // Seed default guild if none exists
  const existing = db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  if (!existing) {
    const id = generateSnowflake();
    const now = Date.now();
    db.prepare(
      "INSERT INTO guilds (id, name, icon, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, "Cove", null, null, now, now);

    // Create @everyone role for the new guild
    db.prepare(
      "INSERT OR IGNORE INTO roles (id, guild_id, name, position, permissions) VALUES (?, ?, '@everyone', 0, ?)"
    ).run(id, id, DEFAULT_EVERYONE_PERMISSIONS.toString());
  }

  return db;
}

const SEED_CHANNELS = [
  { name: "general", type: 0, topic: "General discussion", position: 0 },
  { name: "random", type: 0, topic: "Off-topic chat", position: 1 },
] as const;

export function seedChannels(db: Database.Database, guildId: string): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO channels (id, guild_id, name, type, topic, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Check if channels already exist by name (to preserve OR IGNORE semantics)
  const exists = db.prepare("SELECT id FROM channels WHERE guild_id = ? AND name = ?");

  const tx = db.transaction(() => {
    for (const ch of SEED_CHANNELS) {
      const existing = exists.get(guildId, ch.name);
      if (!existing) {
        insert.run(generateSnowflake(), guildId, ch.name, ch.type, ch.topic, ch.position);
      }
    }
  });
  tx();
}

export function seedUsers(db: Database.Database, guildId: string): void {
  const token = process.env["COVE_ADMIN_TOKEN"];
  if (!token) return;

  const now = Date.now();

  // Find or create users by username (don't use hardcoded string IDs)
  const findByUsername = db.prepare("SELECT id FROM users WHERE username = ?");
  const insert = db.prepare(
    "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const upsertToken = db.prepare(
    "UPDATE users SET token = ?, updated_at = ? WHERE id = ?"
  );

  const ensureUser = (username: string, bot: boolean, userToken: string | null): string => {
    const existing = findByUsername.get(username) as { id: string } | undefined;
    if (existing) {
      if (userToken) upsertToken.run(userToken, now, existing.id);
      return existing.id;
    }
    const id = generateSnowflake();
    // Seed users: bots get expires_at=null (never expire); non-bots without tokens also get null
    insert.run(id, username, null, bot ? 1 : 0, null, userToken, now, now, null);
    return id;
  };

  const lunaId = ensureUser("Luna", false, null);
  const ruantangId = ensureUser("ruantang", true, token);

  const addMember = db.prepare(
    "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
  );
  addMember.run(guildId, lunaId, null, '[]', now);
  addMember.run(guildId, ruantangId, null, '[]', now);
}
