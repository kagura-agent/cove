import Database from "better-sqlite3";

export function initDb(dbPath: string = ":memory:"): Database.Database {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Pre-create migrations: rename old tables BEFORE CREATE TABLE IF NOT EXISTS
  // Handle case where both old (scenes) and new (channels) tables exist
  // (can happen if a buggy deploy created empty channels before rename)
  const hasScenes = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='scenes'"
  ).get();
  if (hasScenes) {
    const hasChannels = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='channels'"
    ).get();
    if (hasChannels) {
      // Drop the empty channels table so rename can proceed
      db.exec("DROP TABLE channels");
    }
    db.exec("ALTER TABLE scenes RENAME TO channels");
  }

  const hasSceneState = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='scene_state'"
  ).get();
  if (hasSceneState) {
    const hasChannelState = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='channel_state'"
    ).get();
    if (hasChannelState) {
      db.exec("DROP TABLE channel_state");
    }
    db.exec("ALTER TABLE scene_state RENAME TO channel_state");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
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
      channel_id       TEXT REFERENCES channels(id),
      sender           TEXT,
      content          TEXT,
      timestamp        INTEGER,
      metadata         TEXT,
      edited_timestamp INTEGER
    );

    CREATE TABLE IF NOT EXISTS channel_state (
      channel_id TEXT REFERENCES channels(id),
      key        TEXT,
      value      TEXT,
      updated_at INTEGER,
      PRIMARY KEY (channel_id, key)
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

  // Migration: add edited_timestamp to existing messages tables
  try {
    db.exec("ALTER TABLE messages ADD COLUMN edited_timestamp INTEGER");
  } catch (_) {
    // Column already exists
  }

  // Migration: add sender_name to store display name alongside sender ID
  try {
    db.exec("ALTER TABLE messages ADD COLUMN sender_name TEXT");
  } catch (_) {
    // Column already exists
  }

  // Migration: add token column to users table (older DBs lack it)
  try {
    db.exec("ALTER TABLE users ADD COLUMN token TEXT");
  } catch (_) {
    // Column already exists
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_token ON users(token)");

  // Post-create migrations: rename columns in already-renamed tables
  try {
    db.exec("ALTER TABLE messages RENAME COLUMN scene_id TO channel_id");
  } catch (_) {
    // Column already named channel_id
  }

  try {
    db.exec("ALTER TABLE channel_state RENAME COLUMN scene_id TO channel_id");
  } catch (_) {
    // Column already named channel_id
  }

  return db;
}

const SEED_CHANNELS = [
  { id: "home", name: "Home", icon: "🏠", type: "indoor", channelId: "kagura-dm", description: "Living room — your cozy home base", x: 300, y: 300 },
  { id: "garden", name: "Garden", icon: "🌱", type: "open", channelId: "garden", description: "Tend your plants and watch them grow", x: 200, y: 200 },
  { id: "workshop", name: "Workshop", icon: "🔨", type: "indoor", channelId: "github-contribution", description: "Where code gets built", x: 500, y: 250 },
  { id: "post-office", name: "Post Office", icon: "📧", type: "indoor", channelId: "kagura-mail", description: "Send and receive letters", x: 350, y: 200 },
] as const;

export function seedChannels(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO channels (id, name, icon, type, channel_id, description, position_x, position_y)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const s of SEED_CHANNELS) {
      insert.run(s.id, s.name, s.icon, s.type, s.channelId, s.description, s.x, s.y);
    }
  });
  tx();
}

export function seedUsers(db: Database.Database): void {
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
  addMember.run("cove", "luna", null, '[]', now);
  addMember.run("cove", "ruantang", null, '[]', now);
}
