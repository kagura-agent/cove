import Database from "better-sqlite3";
import { generateSnowflake, snowflakeFromTimestamp } from "@cove/shared";

const LATEST_VERSION = 4;

type MigrationFn = (db: Database.Database) => void;

const migrations: Record<number, MigrationFn> = {
  1: migrateV0ToV1,
  2: migrateV1ToV2,
  3: migrateV2ToV3,
  4: migrateV3ToV4,
};

function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion > LATEST_VERSION) {
    throw new Error(`Database version ${currentVersion} is newer than supported version ${LATEST_VERSION}. Update the application.`);
  }
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

function migrateV1ToV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS read_states (
      user_id              TEXT NOT NULL,
      channel_id           TEXT NOT NULL,
      last_read_message_id TEXT,
      PRIMARY KEY (user_id, channel_id)
    )
  `);
}

function migrateV2ToV3(db: Database.Database): void {
  // Convert UUID-based IDs to Snowflake IDs across all tables.
  // Generate snowflakes from created_at/timestamp to preserve ordering.

  // Build old→new ID mappings for each table with UUIDs
  const idMap = new Map<string, string>();
  const now = Date.now();

  // Helper: safely query rows from a table that may or may not exist
  const safeQuery = <T>(sql: string, table: string): T[] => {
    if (!tableExists(db, table)) return [];
    return db.prepare(sql).all() as T[];
  };

  // Guilds: use created_at for snowflake timestamp
  const guilds = safeQuery<{ id: string; created_at: string | number }>("SELECT id, created_at FROM guilds", "guilds");
  for (let i = 0; i < guilds.length; i++) {
    const g = guilds[i];
    if (isSnowflake(g.id)) continue;
    idMap.set(g.id, snowflakeFromTimestamp(g.created_at, i));
  }

  // Channels: no created_at, generate from position order
  const channels = safeQuery<{ id: string; guild_id: string }>("SELECT id, guild_id FROM channels ORDER BY position ASC", "channels");
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    if (isSnowflake(ch.id)) continue;
    idMap.set(ch.id, snowflakeFromTimestamp(now, i));
  }

  // Users: use created_at
  const users = safeQuery<{ id: string; created_at: string | number }>("SELECT id, created_at FROM users", "users");
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    if (isSnowflake(u.id)) continue;
    idMap.set(u.id, snowflakeFromTimestamp(u.created_at, i));
  }

  // Messages: use timestamp
  const messages = safeQuery<{ id: string; timestamp: string | number }>("SELECT id, timestamp FROM messages ORDER BY timestamp ASC", "messages");
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (isSnowflake(m.id)) continue;
    idMap.set(m.id, snowflakeFromTimestamp(m.timestamp, i));
  }

  // Invite codes / pending registrations: use created_at
  const invites = safeQuery<{ id: string; created_at: string | number }>("SELECT id, created_at FROM invite_codes", "invite_codes");
  for (let i = 0; i < invites.length; i++) {
    const inv = invites[i];
    if (isSnowflake(inv.id)) continue;
    idMap.set(inv.id, snowflakeFromTimestamp(inv.created_at, i));
  }

  const pendings = safeQuery<{ id: string; created_at: string | number | null }>("SELECT id, created_at FROM pending_registrations", "pending_registrations");
  for (let i = 0; i < pendings.length; i++) {
    const p = pendings[i];
    if (isSnowflake(p.id)) continue;
    idMap.set(p.id, snowflakeFromTimestamp(p.created_at ?? now, i));
  }

  // Apply the ID mapping across all tables
  const hasColumn = (table: string, column: string): boolean => {
    const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
    return cols.some(c => c.name === column);
  };
  const update = (table: string, column: string) => {
    if (!tableExists(db, table) || !hasColumn(table, column)) return;
    const stmt = db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${column}" = ?`);
    for (const [oldId, newId] of idMap) {
      stmt.run(newId, oldId);
    }
  };

  // Primary keys first
  update("guilds", "id");
  update("channels", "id");
  update("users", "id");
  update("messages", "id");
  update("invite_codes", "id");
  update("pending_registrations", "id");

  // Foreign keys
  update("guilds", "owner_id");
  update("channels", "guild_id");
  update("messages", "channel_id");
  update("messages", "sender");
  update("messages", "author_id"); // legacy schema used author_id instead of sender
  update("guild_members", "guild_id");
  update("guild_members", "user_id");
  update("read_states", "user_id");
  update("read_states", "channel_id");
  update("read_states", "last_read_message_id");
  update("invite_codes", "used_by");

  // Convert TEXT timestamps to INTEGER (ms epoch) across all tables.
  // Old databases stored timestamps as ISO strings (e.g. '2026-06-05T02:21:13.160Z').
  const convertTimestamps = (table: string, columns: string[]) => {
    if (!tableExists(db, table)) return;
    for (const col of columns) {
      if (!hasColumn(table, col)) continue;
      const rows = db.prepare(`SELECT rowid, "${col}" FROM "${table}" WHERE "${col}" IS NOT NULL`).all() as Array<{ rowid: number; [key: string]: unknown }>;
      const stmt = db.prepare(`UPDATE "${table}" SET "${col}" = ? WHERE rowid = ?`);
      for (const row of rows) {
        const val = row[col];
        if (typeof val === "number") continue; // already integer
        if (typeof val === "string") {
          const ms = new Date(val).getTime();
          if (!isNaN(ms)) stmt.run(ms, row.rowid);
        }
      }
    }
  };

  convertTimestamps("guilds", ["created_at", "updated_at"]);
  convertTimestamps("users", ["created_at", "updated_at"]);
  convertTimestamps("messages", ["timestamp", "edited_timestamp"]);
  convertTimestamps("guild_members", ["joined_at"]);
  convertTimestamps("invite_codes", ["created_at", "used_at"]);
  convertTimestamps("pending_registrations", ["created_at"]);
}

const SNOWFLAKE_RE = /^[0-9]+$/;
function isSnowflake(id: string): boolean {
  return SNOWFLAKE_RE.test(id);
}

function migrateV3ToV4(db: Database.Database): void {
  // #207: Add google_id and email columns to users table
  // SQLite doesn't allow ALTER TABLE ADD COLUMN with UNIQUE constraint,
  // so we add the column plain and create a unique index separately.
  addColumnIfMissing(db, "users", "google_id", "TEXT");
  addColumnIfMissing(db, "users", "email", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)");

  // #205: Recreate tables with proper FK constraints and NOT NULL
  // SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so we use the recreate pattern.

  // Recreate messages table with proper constraints
  if (tableExists(db, "messages")) {
    // Legacy schema used 'author_id' instead of 'sender'
    const cols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    const senderCol = colNames.includes("sender") ? "sender" : colNames.includes("author_id") ? "author_id" : "NULL";
    const senderNameCol = colNames.includes("sender_name") ? "sender_name" : "NULL";
    const metadataCol = colNames.includes("metadata") ? "metadata" : "NULL";
    const editedCol = colNames.includes("edited_timestamp") ? "edited_timestamp" : "NULL";

    db.exec(`
      CREATE TABLE messages_new (
        id               TEXT PRIMARY KEY,
        channel_id       TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        sender           TEXT REFERENCES users(id) ON DELETE SET NULL,
        content          TEXT NOT NULL,
        timestamp        INTEGER NOT NULL,
        metadata         TEXT,
        edited_timestamp INTEGER,
        sender_name      TEXT
      )
    `);
    db.exec(`
      INSERT INTO messages_new (id, channel_id, sender, content, timestamp, metadata, edited_timestamp, sender_name)
      SELECT id, channel_id,
        CASE WHEN ${senderCol} IN (SELECT id FROM users) THEN ${senderCol} ELSE NULL END,
        COALESCE(content, ''),
        COALESCE(timestamp, 0),
        ${metadataCol}, ${editedCol}, ${senderNameCol}
      FROM messages
      WHERE channel_id IS NOT NULL
    `);
    db.exec("DROP TABLE messages");
    db.exec("ALTER TABLE messages_new RENAME TO messages");
  }

  // Recreate channels table with ON DELETE CASCADE
  if (tableExists(db, "channels")) {
    db.exec(`
      CREATE TABLE channels_new (
        id          TEXT PRIMARY KEY,
        guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        type        INTEGER NOT NULL DEFAULT 0,
        topic       TEXT,
        position    INTEGER NOT NULL DEFAULT 0
      )
    `);
    db.exec(`
      INSERT INTO channels_new (id, guild_id, name, type, topic, position)
      SELECT id, guild_id, name, type, topic, position
      FROM channels
      WHERE guild_id IN (SELECT id FROM guilds)
    `);
    db.exec("DROP TABLE channels");
    db.exec("ALTER TABLE channels_new RENAME TO channels");
  }

  // Recreate read_states with FK constraints
  if (tableExists(db, "read_states")) {
    db.exec(`
      CREATE TABLE read_states_new (
        user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id           TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        last_read_message_id TEXT,
        PRIMARY KEY (user_id, channel_id)
      )
    `);
    db.exec(`
      INSERT INTO read_states_new (user_id, channel_id, last_read_message_id)
      SELECT user_id, channel_id, last_read_message_id
      FROM read_states
      WHERE user_id IN (SELECT id FROM users)
        AND channel_id IN (SELECT id FROM channels)
    `);
    db.exec("DROP TABLE read_states");
    db.exec("ALTER TABLE read_states_new RENAME TO read_states");
  }

  // #204: Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_guild_members_user_id ON guild_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_channels_guild_pos ON channels(guild_id, position);
  `);
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
      guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
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
      google_id   TEXT UNIQUE,
      email       TEXT,
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
