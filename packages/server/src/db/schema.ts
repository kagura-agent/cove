import Database from "better-sqlite3";
import { generateSnowflake } from "@cove/shared";
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
      last_message_id  TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT NOT NULL,
      avatar      TEXT,
      bot         INTEGER NOT NULL DEFAULT 1,
      bio         TEXT,
      token       TEXT UNIQUE,
      google_id   TEXT UNIQUE,
      email       TEXT UNIQUE,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
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
      created_at    INTEGER
    );

    CREATE TABLE IF NOT EXISTS read_states (
      user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_id           TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      last_read_message_id TEXT,
      PRIMARY KEY (user_id, channel_id)
    );
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
    "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
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
    insert.run(id, username, null, bot ? 1 : 0, null, userToken, now, now);
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
