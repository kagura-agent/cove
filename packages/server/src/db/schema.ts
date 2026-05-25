import Database from "better-sqlite3";

export function initDb(dbPath: string = ":memory:"): Database.Database {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS scenes (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      icon        TEXT,
      type        TEXT CHECK(type IN ('open', 'indoor', 'object', 'structure')),
      channel_id  TEXT,
      description TEXT,
      position_x  REAL,
      position_y  REAL
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
      guild_id    TEXT NOT NULL DEFAULT 'cove',
      user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
      nick        TEXT,
      roles       TEXT DEFAULT '[]',
      joined_at   INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id               TEXT PRIMARY KEY,
      scene_id         TEXT REFERENCES scenes(id),
      sender           TEXT,
      content          TEXT,
      timestamp        INTEGER,
      metadata         TEXT,
      edited_timestamp INTEGER
    );

    CREATE TABLE IF NOT EXISTS scene_state (
      scene_id   TEXT REFERENCES scenes(id),
      key        TEXT,
      value      TEXT,
      updated_at INTEGER,
      PRIMARY KEY (scene_id, key)
    );
  `);

  // Migration: add edited_timestamp to existing messages tables
  try {
    db.exec("ALTER TABLE messages ADD COLUMN edited_timestamp INTEGER");
  } catch (_) {
    // Column already exists — ignore
  }

  // Migration: add sender_name to store display name alongside sender ID
  try {
    db.exec("ALTER TABLE messages ADD COLUMN sender_name TEXT");
  } catch (_) {
    // Column already exists — ignore
  }

  // Migration: add token column to users table (older DBs lack it)
  try {
    db.exec("ALTER TABLE users ADD COLUMN token TEXT UNIQUE");
  } catch (_) {
    // Column already exists — ignore
  }

  return db;
}

// Core scenes for Phase 1. Additional scenes are unlocked progressively
// as features are implemented (see README scene table for the full list).
const SEED_SCENES = [
  { id: "home", name: "Home", icon: "🏠", type: "indoor", channelId: "kagura-dm", description: "Living room — your cozy home base", x: 300, y: 300 },
  { id: "garden", name: "Garden", icon: "🌱", type: "open", channelId: "garden", description: "Tend your plants and watch them grow", x: 200, y: 200 },
  { id: "workshop", name: "Workshop", icon: "🔨", type: "indoor", channelId: "github-contribution", description: "Where code gets built", x: 500, y: 250 },
  { id: "post-office", name: "Post Office", icon: "📧", type: "indoor", channelId: "kagura-mail", description: "Send and receive letters", x: 350, y: 200 },
] as const;

export function seedScenes(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO scenes (id, name, icon, type, channel_id, description, position_x, position_y)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const s of SEED_SCENES) {
      insert.run(s.id, s.name, s.icon, s.type, s.channelId, s.description, s.x, s.y);
    }
  });
  tx();
}

export function seedAdminBot(db: Database.Database): void {
  const token = process.env["COVE_ADMIN_TOKEN"];
  if (!token) return;

  const now = Date.now();
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("admin", "admin", null, 1, "System admin bot", token, now, now);
}
