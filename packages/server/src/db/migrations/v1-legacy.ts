import Database from "better-sqlite3";
import { generateSnowflake } from "@cove/shared";
import { tableExists, addColumnIfMissing, migrateRenameTable } from "./util.js";
import { createAllTables } from "../schema.js";

export function migrateV0ToV1(db: Database.Database): void {
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

function migrateChannelsToDiscordSchema(db: Database.Database): void {
  const tableInfo = db.prepare("PRAGMA table_info(channels)").all() as Array<{ name: string }>;
  const hasPositionX = tableInfo.some(col => col.name === "position_x");
  if (!hasPositionX) return;

  // FK is disabled at the initDb() level before runMigrations();
  // do NOT toggle foreign_keys here (it's a no-op inside transactions).
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
    const id = generateSnowflake();
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

  // Add guild_id to channels (FK is OFF at initDb level)
  try {
    db.exec(`ALTER TABLE channels ADD COLUMN guild_id TEXT NOT NULL DEFAULT '${guildId}'`);
  } catch (e: unknown) {
    if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
  }

  // Migrate island-style channels to discord schema
  migrateChannelsToDiscordSchema(db);

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
