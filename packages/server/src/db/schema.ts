import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

function migrateRenameTable(db: Database.Database, oldName: string, newName: string): void {
  const hasOld = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(oldName);
  if (!hasOld) return;

  const hasNew = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(newName);
  if (hasNew) {
    const newCount = (db.prepare(`SELECT COUNT(*) as c FROM "${newName}"`).get() as { c: number }).c;
    if (newCount > 0) {
      const oldCount = (db.prepare(`SELECT COUNT(*) as c FROM "${oldName}"`).get() as { c: number }).c;
      if (oldCount > 0) {
        throw new Error(
          `Migration conflict: both "${oldName}" (${oldCount} rows) and "${newName}" (${newCount} rows) contain data. ` +
          `Manually resolve before starting the server.`
        );
      }
      // New table has data, old is empty — drop old, keep new
      db.exec(`DROP TABLE "${oldName}"`);
      return;
    }
    // New table is empty — safe to drop and rename
    db.exec(`DROP TABLE "${newName}"`);
  }
  db.exec(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
}

export function initDb(dbPath: string = ":memory:"): Database.Database {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Pre-create migrations: rename old tables BEFORE CREATE TABLE IF NOT EXISTS
  migrateRenameTable(db, "scenes", "channels");

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
      id          TEXT PRIMARY KEY,
      guild_id    TEXT NOT NULL REFERENCES guilds(id),
      name        TEXT NOT NULL,
      type        INTEGER NOT NULL DEFAULT 0,
      topic       TEXT,
      position    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT NOT NULL,
      avatar      TEXT,
      bot         INTEGER NOT NULL DEFAULT 1,
      bio         TEXT,
      token       TEXT UNIQUE,
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
      channel_id       TEXT REFERENCES channels(id),
      sender           TEXT,
      content          TEXT,
      timestamp        INTEGER,
      metadata         TEXT,
      edited_timestamp INTEGER
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
  `);

  // Seed default guild (must exist before FK references from channels)
  const guildId = (() => {
    const existing = db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    const now = Date.now();
    db.prepare(
      "INSERT INTO guilds (id, name, icon, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, "Cove", null, null, now, now);
    return id;
  })();

  // Migration: add edited_timestamp to existing messages tables
  try {
    db.exec("ALTER TABLE messages ADD COLUMN edited_timestamp INTEGER");
  } catch (e: unknown) {
    if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
  }

  // Migration: add sender_name to store display name alongside sender ID
  try {
    db.exec("ALTER TABLE messages ADD COLUMN sender_name TEXT");
  } catch (e: unknown) {
    if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
  }

  // Migration: add token column to users table (older DBs lack it)
  try {
    db.exec("ALTER TABLE users ADD COLUMN token TEXT");
  } catch (e: unknown) {
    if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_token ON users(token)");

  // Migration: add guild_id to channels table
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`ALTER TABLE channels ADD COLUMN guild_id TEXT NOT NULL DEFAULT '${guildId}'`);
  } catch (e: unknown) {
    if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
  } finally {
    db.pragma('foreign_keys = ON');
  }

  // Migration: rebuild channels table if it has old island-specific columns
  migrateChannelsToDiscordSchema(db, guildId);

  // Migration: drop channel_state table if it exists
  db.exec("DROP TABLE IF EXISTS channel_state");

  // Post-create migrations: rename columns in already-renamed tables
  try {
    db.exec("ALTER TABLE messages RENAME COLUMN scene_id TO channel_id");
  } catch (e: unknown) {
    if (!(e instanceof Error && /no such column/i.test(e.message))) throw e;
  }

  return db;
}

/**
 * Migrate channels table from island schema to Discord schema.
 * Old schema had: icon, type (TEXT), channel_id, description, position_x, position_y
 * New schema has: type (INTEGER), topic, position (INTEGER)
 */
function migrateChannelsToDiscordSchema(db: Database.Database, _guildId: string): void {
  // Check if old schema exists by looking for position_x column
  const tableInfo = db.prepare("PRAGMA table_info(channels)").all() as Array<{ name: string }>;
  const hasPositionX = tableInfo.some(col => col.name === "position_x");
  if (!hasPositionX) return; // Already new schema

  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE channels_new (
        id          TEXT PRIMARY KEY,
        guild_id    TEXT NOT NULL REFERENCES guilds(id),
        name        TEXT NOT NULL,
        type        INTEGER NOT NULL DEFAULT 0,
        topic       TEXT,
        position    INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Copy data, mapping description→topic, dropping removed columns
    // type becomes 0 (GUILD_TEXT) for all existing channels
    db.exec(`
      INSERT INTO channels_new (id, guild_id, name, type, topic, position)
      SELECT id, guild_id, name, 0, description, 0
      FROM channels
    `);

    // Assign positions based on rowid order
    db.exec(`
      UPDATE channels_new SET position = (
        SELECT COUNT(*) FROM channels_new c2 WHERE c2.rowid < channels_new.rowid
      )
    `);

    db.exec("DROP TABLE channels");
    db.exec("ALTER TABLE channels_new RENAME TO channels");
  })();
  db.pragma('foreign_keys = ON');
}

const SEED_CHANNELS = [
  { id: "general", name: "general", type: 0, topic: "General discussion", position: 0 },
  { id: "random", name: "random", type: 0, topic: "Off-topic chat", position: 1 },
] as const;

export function seedChannels(db: Database.Database, guildId: string): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO channels (id, guild_id, name, type, topic, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const ch of SEED_CHANNELS) {
      insert.run(ch.id, guildId, ch.name, ch.type, ch.topic, ch.position);
    }
  });
  tx();
}

export function seedUsers(db: Database.Database, guildId: string): void {
  const token = process.env["COVE_ADMIN_TOKEN"];
  if (!token) return;

  const now = Date.now();
  const insert = db.prepare(
    "INSERT OR REPLACE INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insert.run("luna", "Luna", null, 0, null, null, now, now);
  insert.run("ruantang", "ruantang", null, 1, null, token, now, now);

  // Ensure seeded users are guild members
  const addMember = db.prepare(
    "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
  );
  addMember.run(guildId, "luna", null, '[]', now);
  addMember.run(guildId, "ruantang", null, '[]', now);
}
