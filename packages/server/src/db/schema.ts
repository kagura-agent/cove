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

const SEED_SCENES = [
  { id: "home", name: "Home", icon: "🏠", type: "indoor", channelId: "kagura-dm", description: "Living room — your cozy home base", x: 300, y: 300 },
  { id: "garden", name: "Garden", icon: "🌱", type: "open", channelId: "garden", description: "Tend your plants and watch them grow", x: 200, y: 200 },
  { id: "school", name: "School", icon: "📚", type: "indoor", channelId: "study", description: "Library and study hall", x: 400, y: 150 },
  { id: "workshop", name: "Workshop", icon: "🔨", type: "indoor", channelId: "github-contribution", description: "Where code gets built", x: 500, y: 250 },
  { id: "counting-house", name: "Counting House", icon: "💰", type: "indoor", channelId: "finance", description: "Track your finances", x: 450, y: 350 },
  { id: "trading-hall", name: "Trading Hall", icon: "📈", type: "indoor", channelId: "finance", description: "Watch the markets move", x: 500, y: 400 },
  { id: "market", name: "Market", icon: "🛒", type: "open", channelId: "shopping", description: "Browse goods and shop", x: 250, y: 450 },
  { id: "post-office", name: "Post Office", icon: "📧", type: "indoor", channelId: "kagura-mail", description: "Send and receive letters", x: 350, y: 200 },
  { id: "harbor", name: "Harbor", icon: "🦞", type: "open", channelId: "lobster-post", description: "Ships come and go at the dock", x: 100, y: 400 },
  { id: "art-studio", name: "Art Studio", icon: "🎨", type: "indoor", channelId: "kagura-canvas", description: "Create and display artwork", x: 150, y: 300 },
  { id: "writing-desk", name: "Writing Desk", icon: "📓", type: "object", channelId: "kagura-profile", description: "Your personal journal", x: 320, y: 280 },
  { id: "lab", name: "Lab", icon: "🧬", type: "indoor", channelId: "evolution", description: "Experiments and evolution", x: 550, y: 300 },
  { id: "garage", name: "Garage", icon: "🔧", type: "indoor", channelId: "toolchain", description: "Tools and machinery", x: 600, y: 350 },
  { id: "track", name: "Track", icon: "🏃", type: "open", channelId: "coros", description: "Run laps and stay fit", x: 100, y: 150 },
  { id: "file-cabinet", name: "File Cabinet", icon: "👨‍👩‍👧", type: "object", channelId: "family-care", description: "Family records and care notes", x: 350, y: 350 },
  { id: "storefront", name: "Storefront", icon: "💼", type: "indoor", channelId: "gtm", description: "Your business front", x: 450, y: 450 },
  { id: "teahouse", name: "Teahouse", icon: "🐕", type: "indoor", channelId: "agent-collab", description: "Meet and chat with others", x: 200, y: 350 },
  { id: "arcade", name: "Arcade", icon: "🤡", type: "indoor", channelId: "agent-memes", description: "Games and silly fun", x: 150, y: 450 },
  { id: "broadcast-tower", name: "Broadcast Tower", icon: "📰", type: "structure", channelId: "crosspost", description: "News and announcements", x: 600, y: 150 },
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
