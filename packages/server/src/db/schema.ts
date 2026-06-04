import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const LATEST_VERSION = 1;

type MigrationFn = (db: Database.Database) => void;

const migrations: Record<number, MigrationFn> = {
  1: migrateV0ToV1,
};

function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion >= LATEST_VERSION) return;

  for (let v = currentVersion + 1; v <= LATEST_VERSION; v++) {
    const migration = migrations[v];
    if (!migration) {
      throw new Error(`Missing migration for version ${v}`);
    }
    console.log(`Running migration V${v - 1} → V${v}...`);
    db.transaction(() => {
      migration(db);
      db.pragma(`user_version = ${v}`);
    })();
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name);
}

function migrateV0ToV1(db: Database.Database): void {
  // Detect if this is a legacy database (has existing tables) or fresh
  const hasAnyTable = tableExists(db, "channels") ||
    tableExists(db, "scenes") ||
    tableExists(db, "messages") ||
    tableExists(db, "users");

  if (!hasAnyTable) {
    // Fresh database: create all tables directly with final schema
    createAllTables(db);
    return;
  }

  // Legacy database: run all the old migrations
  migrateLegacyToV1(db);
}

function createAllTables(db: Database.Database): void {
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
  `);
}

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
      db.exec(`DROP TABLE "${oldName}"`);
      return;
    }
    db.exec(`DROP TABLE "${newName}"`);
  }
  db.exec(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
}

function migrateChannelsToDiscordSchema(db: Database.Database, guildId: string): void {
  const tableInfo = db.prepare("PRAGMA table_info(channels)").all() as Array<{ name: string }>;
  const hasPositionX = tableInfo.some(col => col.name === "position_x");
  if (!hasPositionX) return;

  db.pragma('foreign_keys = OFF');
  try {
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

    db.exec(`
      INSERT INTO channels_new (id, guild_id, name, type, topic, position)
      SELECT id, guild_id, name, 0, description, 0
      FROM channels
    `);

    db.exec(`
      UPDATE channels_new SET position = (
        SELECT COUNT(*) FROM channels_new c2 WHERE c2.rowid < channels_new.rowid
      )
    `);

    db.exec("DROP TABLE channels");
    db.exec("ALTER TABLE channels_new RENAME TO channels");
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e: unknown) {
    if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
  }
}

function migrateLegacyToV1(db: Database.Database): void {
  // Rename scenes → channels
  migrateRenameTable(db, "scenes", "channels");

  // Ensure all tables exist (some may be missing in old DBs)
  createAllTables(db);

  // Seed a default guild if none exists (needed for guild_id column migration)
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

  // Add missing columns
  addColumnIfMissing(db, "messages", "edited_timestamp", "INTEGER");
  addColumnIfMissing(db, "messages", "sender_name", "TEXT");
  addColumnIfMissing(db, "users", "token", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_token ON users(token)");

  // Add guild_id to channels
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`ALTER TABLE channels ADD COLUMN guild_id TEXT NOT NULL DEFAULT '${guildId}'`);
  } catch (e: unknown) {
    if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
  } finally {
    db.pragma('foreign_keys = ON');
  }

  // Migrate island-style channels to discord schema
  migrateChannelsToDiscordSchema(db, guildId);

  // Drop obsolete tables
  db.exec("DROP TABLE IF EXISTS channel_state");
  db.exec("DROP TABLE IF EXISTS scene_state");

  // Rename scene_id → channel_id in messages
  try {
    db.exec("ALTER TABLE messages RENAME COLUMN scene_id TO channel_id");
  } catch (e: unknown) {
    if (!(e instanceof Error && /no such column/i.test(e.message))) throw e;
  }
}

export function initDb(dbPath: string = ":memory:"): Database.Database {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  // Seed default guild if none exists
  const existing = db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  if (!existing) {
    const id = randomUUID();
    const now = Date.now();
    db.prepare(
      "INSERT INTO guilds (id, name, icon, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, "Cove", null, null, now, now);
  }

  return db;
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

  const addMember = db.prepare(
    "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
  );
  addMember.run(guildId, "luna", null, '[]', now);
  addMember.run(guildId, "ruantang", null, '[]', now);
}
