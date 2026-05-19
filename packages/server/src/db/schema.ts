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

    CREATE TABLE IF NOT EXISTS messages (
      id         TEXT PRIMARY KEY,
      scene_id   TEXT REFERENCES scenes(id),
      sender     TEXT,
      content    TEXT,
      timestamp  INTEGER,
      metadata   TEXT
    );

    CREATE TABLE IF NOT EXISTS scene_state (
      scene_id   TEXT REFERENCES scenes(id),
      key        TEXT,
      value      TEXT,
      updated_at INTEGER,
      PRIMARY KEY (scene_id, key)
    );
  `);

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
