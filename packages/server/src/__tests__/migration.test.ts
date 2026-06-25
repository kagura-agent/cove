import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../db/schema.js";
import { snowflakeToTimestamp } from "@cove/shared";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function tmpDb(): string {
  return path.join(os.tmpdir(), `cove-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("versioned migration system", () => {
  it("fresh DB gets user_version = 19", () => {
    const db = initDb();
    const version = db.pragma("user_version", { simple: true });
    expect(version).toBe(20);
    db.close();
  });

  it("already at latest version: no migrations run", () => {
    const tmpFile = tmpDb();
    try {
      // First init sets up everything
      const db1 = initDb(tmpFile);
      db1.close();

      // Second init should not re-run migrations
      const spy = vi.spyOn(console, "log");
      const db2 = initDb(tmpFile);
      const migrationLogs = spy.mock.calls.filter(
        (args) => typeof args[0] === "string" && args[0].includes("Running migration")
      );
      expect(migrationLogs).toHaveLength(0);
      spy.mockRestore();
      db2.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("fresh DB creates all expected tables", () => {
    const db = initDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    expect(names).toContain("guilds");
    expect(names).toContain("channels");
    expect(names).toContain("users");
    expect(names).toContain("guild_members");
    expect(names).toContain("messages");
    expect(names).toContain("invite_codes");
    expect(names).toContain("pending_registrations");
    expect(names).toContain("read_states");
    expect(names).toContain("attachments");
    expect(names).toContain("roles");
    db.close();
  });

  it("seeds a default guild", () => {
    const db = initDb();
    const guild = db.prepare("SELECT id, name FROM guilds LIMIT 1").get() as { id: string; name: string };
    expect(guild).toBeDefined();
    expect(guild.name).toBe("Cove");
    db.close();
  });

  it("throws on future DB version (newer than supported)", () => {
    const tmpFile = tmpDb();
    try {
      const setup = new Database(tmpFile);
      setup.pragma("journal_mode = WAL");
      setup.pragma("user_version = 999");
      setup.close();

      expect(() => initDb(tmpFile)).toThrow(/newer than supported/);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("V1→V2 migration creates read_states table", () => {
    const tmpFile = tmpDb();
    try {
      // Create a V1 database manually
      const setup = new Database(tmpFile);
      setup.pragma("journal_mode = WAL");
      setup.pragma("foreign_keys = OFF");
      setup.exec(`
        CREATE TABLE guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, owner_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE channels (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, avatar TEXT, bot INTEGER NOT NULL DEFAULT 1, bio TEXT, token TEXT UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE guild_members (guild_id TEXT NOT NULL, user_id TEXT, nick TEXT, roles TEXT DEFAULT '[]', joined_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));
        CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT, sender TEXT, content TEXT, timestamp INTEGER, metadata TEXT, edited_timestamp INTEGER, sender_name TEXT);
        CREATE TABLE invite_codes (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER, used_by TEXT);
        CREATE TABLE pending_registrations (id TEXT PRIMARY KEY, pending_token TEXT UNIQUE NOT NULL, google_id TEXT, email TEXT, username TEXT, avatar TEXT, created_at INTEGER);
      `);
      setup.exec("INSERT INTO guilds (id, name, created_at, updated_at) VALUES ('g1', 'Cove', 1000, 1000)");
      setup.pragma("user_version = 1");
      setup.close();

      const db = initDb(tmpFile);
      const version = db.pragma("user_version", { simple: true });
      expect(version).toBe(20);

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='read_states'").all();
      expect(tables).toHaveLength(1);

      // Verify the table works — use existing guild/user/channel data
      const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
      const ch = db.prepare("SELECT id FROM channels LIMIT 1").get() as { id: string } | undefined;
      if (ch) {
        // Need a user to satisfy FK
        const userId = "test-u1";
        const now = Date.now();
        db.prepare("INSERT INTO users (id, username, bot, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(userId, "Test", 0, now, now);
        db.prepare("INSERT INTO read_states (user_id, channel_id, last_read_message_id) VALUES (?, ?, ?)").run(userId, ch.id, "msg1");
        const row = db.prepare("SELECT * FROM read_states WHERE user_id = ?").get(userId) as Record<string, unknown>;
        expect(row).toBeDefined();
        expect(row.last_read_message_id).toBe("msg1");
      } else {
        // No channels seeded — just verify the table schema exists
        const columns = db.prepare("PRAGMA table_info(read_states)").all() as Array<{ name: string }>;
        expect(columns.map(c => c.name)).toContain("user_id");
      }

      db.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("legacy DB with FK-bearing messages migrates successfully", () => {
    const tmpFile = tmpDb();
    try {
      const setup = new Database(tmpFile);
      setup.exec(`
        CREATE TABLE guilds (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT,
          owner_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )
      `);
      setup.exec("INSERT INTO guilds (id, name, created_at, updated_at) VALUES ('g1', 'Test', 1000, 1000)");
      setup.exec(`
        CREATE TABLE channels (
          id TEXT PRIMARY KEY, guild_id TEXT NOT NULL,
          name TEXT NOT NULL, icon TEXT, type TEXT, channel_id TEXT,
          description TEXT, position_x REAL, position_y REAL
        )
      `);
      setup.exec("INSERT INTO channels (id, guild_id, name, type, description, position_x, position_y) VALUES ('ch1', 'g1', 'General', 'open', 'Main channel', 100, 200)");
      setup.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, discriminator TEXT DEFAULT '0',
          avatar TEXT, bot INTEGER DEFAULT 0, token TEXT, google_id TEXT, created_at INTEGER)
      `);
      setup.exec("INSERT INTO users (id, username, created_at) VALUES ('u1', 'TestUser', 1000)");
      setup.exec(`
        CREATE TABLE messages (
          id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id),
          content TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id),
          timestamp TEXT NOT NULL, edited_timestamp TEXT, type INTEGER DEFAULT 0
        )
      `);
      setup.exec("INSERT INTO messages (id, channel_id, content, author_id, timestamp) VALUES ('m1', 'ch1', 'hello', 'u1', '2026-01-01T00:00:00Z')");
      setup.close();

      // This should NOT throw — FK is disabled during migration
      const db = initDb(tmpFile);
      const msg = db.prepare("SELECT * FROM messages WHERE content = 'hello'").get() as Record<string, unknown>;
      expect(msg).toBeDefined();
      expect(msg.content).toBe("hello");
      // ID should now be a snowflake
      expect(String(msg.id)).toMatch(/^\d+$/);
      const version = db.pragma("user_version", { simple: true });
      expect(version).toBe(20);
      db.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });
});

describe("scenes→channels migration guard", () => {
  it("renames scenes to channels when channels does not exist", () => {
    const tmpFile = tmpDb();

    try {
      const setup = new Database(tmpFile);
      setup.exec(`CREATE TABLE guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, owner_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
      setup.exec(`INSERT INTO guilds (id, name, created_at, updated_at) VALUES ('g1', 'Test', 1000, 1000)`);
      setup.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`INSERT INTO scenes (id, guild_id, name) VALUES ('s1', 'g1', 'Scene1')`);
      setup.close();

      const db2 = initDb(tmpFile);
      const rows = db2.prepare("SELECT id, name FROM channels WHERE name = 'Scene1'").all() as { id: string; name: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Scene1");

      const version = db2.pragma("user_version", { simple: true });
      expect(version).toBe(20);
      db2.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("throws when both tables have data", () => {
    const tmpFile = tmpDb();

    try {
      const setup = new Database(tmpFile);
      setup.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`CREATE TABLE channels (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`INSERT INTO scenes (id, guild_id, name) VALUES ('s1', 'g1', 'OldData')`);
      setup.exec(`INSERT INTO channels (id, guild_id, name) VALUES ('c1', 'g1', 'NewData')`);
      setup.close();

      expect(() => initDb(tmpFile)).toThrow(/Migration conflict/);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("keeps new table data when old table is empty", () => {
    const tmpFile = tmpDb();

    try {
      const setup = new Database(tmpFile);
      setup.exec(`CREATE TABLE guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, owner_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
      setup.exec(`INSERT INTO guilds (id, name, created_at, updated_at) VALUES ('g1', 'Test', 1000, 1000)`);
      setup.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`CREATE TABLE channels (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`INSERT INTO channels (id, guild_id, name) VALUES ('c1', 'g1', 'NewData')`);
      setup.close();

      const db2 = initDb(tmpFile);
      const rows = db2.prepare("SELECT id, name FROM channels WHERE name = 'NewData'").all() as { id: string; name: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("NewData");
      db2.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("drops empty new table and renames old", () => {
    const tmpFile = tmpDb();

    try {
      const setup = new Database(tmpFile);
      setup.exec(`CREATE TABLE guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, owner_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
      setup.exec(`INSERT INTO guilds (id, name, created_at, updated_at) VALUES ('g1', 'Test', 1000, 1000)`);
      setup.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`CREATE TABLE channels (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`INSERT INTO scenes (id, guild_id, name) VALUES ('s1', 'g1', 'OldData')`);
      setup.close();

      const db2 = initDb(tmpFile);
      const rows = db2.prepare("SELECT id, name FROM channels WHERE name = 'OldData'").all() as { id: string; name: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("OldData");
      db2.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });
});

describe("island→discord schema migration", () => {
  it("migrates old island-style channels to discord schema", () => {
    const tmpFile = tmpDb();

    try {
      const setup = new Database(tmpFile);
      setup.exec(`
        CREATE TABLE guilds (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT,
          owner_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      setup.exec(`INSERT INTO guilds (id, name, created_at, updated_at) VALUES ('g1', 'Test', 1000, 1000)`);
      setup.exec(`
        CREATE TABLE channels (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          name TEXT NOT NULL,
          icon TEXT,
          type TEXT,
          channel_id TEXT,
          description TEXT,
          position_x REAL,
          position_y REAL
        )
      `);
      setup.exec(`INSERT INTO channels (id, guild_id, name, icon, type, channel_id, description, position_x, position_y) VALUES ('home', 'g1', 'Home', '🏠', 'indoor', 'kagura-dm', 'Living room', 300, 300)`);
      setup.exec(`INSERT INTO channels (id, guild_id, name, icon, type, channel_id, description, position_x, position_y) VALUES ('garden', 'g1', 'Garden', '🌱', 'open', 'garden', 'Tend plants', 200, 200)`);
      setup.close();

      const db2 = initDb(tmpFile);

      const rows = db2.prepare("SELECT * FROM channels ORDER BY position").all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);

      expect(rows[0]).toHaveProperty("type");
      expect(rows[0]).toHaveProperty("topic");
      expect(rows[0]).toHaveProperty("position");

      expect(rows[0]).not.toHaveProperty("icon");
      expect(rows[0]).not.toHaveProperty("position_x");
      expect(rows[0]).not.toHaveProperty("position_y");
      expect(rows[0]).not.toHaveProperty("channel_id");
      expect(rows[0]).not.toHaveProperty("description");

      expect(rows[0].type).toBe(0);
      expect(rows[0].topic).toBe("Living room");

      const version = db2.pragma("user_version", { simple: true });
      expect(version).toBe(20);

      db2.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("drops channel_state table", () => {
    const tmpFile = tmpDb();

    try {
      const setup = new Database(tmpFile);
      setup.exec(`
        CREATE TABLE guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, owner_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)
      `);
      setup.exec(`INSERT INTO guilds (id, name, created_at, updated_at) VALUES ('g1', 'Test', 1000, 1000)`);
      setup.exec(`
        CREATE TABLE channels (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)
      `);
      setup.exec(`
        CREATE TABLE channel_state (channel_id TEXT, key TEXT, value TEXT, updated_at INTEGER, PRIMARY KEY (channel_id, key))
      `);
      setup.exec(`INSERT INTO channel_state (channel_id, key, value, updated_at) VALUES ('ch1', 'mood', 'happy', 1000)`);
      setup.close();

      const db2 = initDb(tmpFile);

      const tables = db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channel_state'").all();
      expect(tables).toHaveLength(0);

      db2.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });
});

describe("V2→V3 migration (UUID→Snowflake)", () => {
  it("converts UUID guild IDs to snowflakes", () => {
    const tmpFile = tmpDb();
    try {
      const setup = new Database(tmpFile);
      setup.pragma("journal_mode = WAL");
      setup.pragma("foreign_keys = OFF");
      setup.exec(`
        CREATE TABLE guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, owner_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE channels (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, avatar TEXT, bot INTEGER NOT NULL DEFAULT 1, bio TEXT, token TEXT UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE guild_members (guild_id TEXT NOT NULL, user_id TEXT, nick TEXT, roles TEXT DEFAULT '[]', joined_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));
        CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT, sender TEXT, content TEXT, timestamp INTEGER, metadata TEXT, edited_timestamp INTEGER, sender_name TEXT);
        CREATE TABLE invite_codes (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER, used_by TEXT);
        CREATE TABLE pending_registrations (id TEXT PRIMARY KEY, pending_token TEXT UNIQUE NOT NULL, google_id TEXT, email TEXT, username TEXT, avatar TEXT, created_at INTEGER);
        CREATE TABLE read_states (user_id TEXT NOT NULL, channel_id TEXT NOT NULL, last_read_message_id TEXT, PRIMARY KEY (user_id, channel_id));
      `);

      const guildTime = 1700000000000;
      const userTime = 1700000001000;
      const msgTime = 1700000002000;

      setup.exec(`INSERT INTO guilds (id, name, created_at, updated_at) VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'TestGuild', ${guildTime}, ${guildTime})`);
      setup.exec(`INSERT INTO channels (id, guild_id, name) VALUES ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'general')`);
      setup.exec(`INSERT INTO users (id, username, bot, token, created_at, updated_at) VALUES ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'TestUser', 1, 'tok', ${userTime}, ${userTime})`);
      setup.exec(`INSERT INTO guild_members (guild_id, user_id, joined_at) VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', ${userTime})`);
      setup.exec(`INSERT INTO messages (id, channel_id, sender, content, timestamp) VALUES ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'hello', ${msgTime})`);
      setup.exec(`INSERT INTO read_states (user_id, channel_id, last_read_message_id) VALUES ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44')`);
      setup.pragma("user_version = 2");
      setup.close();

      const db = initDb(tmpFile);

      // Version should be 3
      expect(db.pragma("user_version", { simple: true })).toBe(20);

      // Guild ID should be a snowflake (numeric string)
      const guild = db.prepare("SELECT id, name FROM guilds WHERE name = 'TestGuild'").get() as { id: string; name: string };
      expect(guild.id).toMatch(/^\d+$/);

      // Snowflake timestamp should match the original created_at
      expect(snowflakeToTimestamp(guild.id)).toBe(guildTime);

      // Channel's guild_id FK should point to the new guild ID
      const ch = db.prepare("SELECT id, guild_id FROM channels WHERE name = 'general'").get() as { id: string; guild_id: string };
      expect(ch.id).toMatch(/^\d+$/);
      expect(ch.guild_id).toBe(guild.id);

      // Message references should be updated
      const msg = db.prepare("SELECT id, channel_id, sender FROM messages").get() as { id: string; channel_id: string; sender: string };
      expect(msg.id).toMatch(/^\d+$/);
      expect(msg.channel_id).toBe(ch.id);

      const user = db.prepare("SELECT id FROM users WHERE username = 'TestUser'").get() as { id: string };
      expect(msg.sender).toBe(user.id);

      // Read state should point to new IDs
      const rs = db.prepare("SELECT * FROM read_states").get() as { user_id: string; channel_id: string; last_read_message_id: string };
      expect(rs.user_id).toBe(user.id);
      expect(rs.channel_id).toBe(ch.id);
      expect(rs.last_read_message_id).toBe(msg.id);

      db.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("converts non-UUID text IDs to snowflakes during migration", () => {
    const tmpFile = tmpDb();
    try {
      const setup = new Database(tmpFile);
      setup.pragma("journal_mode = WAL");
      setup.pragma("foreign_keys = OFF");
      setup.exec(`
        CREATE TABLE guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, owner_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE channels (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, avatar TEXT, bot INTEGER NOT NULL DEFAULT 1, bio TEXT, token TEXT UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE guild_members (guild_id TEXT NOT NULL, user_id TEXT, nick TEXT, roles TEXT DEFAULT '[]', joined_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));
        CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT, sender TEXT, content TEXT, timestamp INTEGER, metadata TEXT, edited_timestamp INTEGER, sender_name TEXT);
        CREATE TABLE invite_codes (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER, used_by TEXT);
        CREATE TABLE pending_registrations (id TEXT PRIMARY KEY, pending_token TEXT UNIQUE NOT NULL, google_id TEXT, email TEXT, username TEXT, avatar TEXT, created_at INTEGER);
        CREATE TABLE read_states (user_id TEXT NOT NULL, channel_id TEXT NOT NULL, last_read_message_id TEXT, PRIMARY KEY (user_id, channel_id));
      `);

      const now = Date.now();
      setup.exec(`INSERT INTO guilds (id, name, created_at, updated_at) VALUES ('my-guild', 'TestGuild', ${now}, ${now})`);
      setup.exec(`INSERT INTO channels (id, guild_id, name) VALUES ('general', 'my-guild', 'general')`);
      setup.exec(`INSERT INTO users (id, username, bot, token, created_at, updated_at) VALUES ('luna', 'Luna', 0, 'tok', ${now}, ${now})`);
      setup.exec(`INSERT INTO guild_members (guild_id, user_id, joined_at) VALUES ('my-guild', 'luna', ${now})`);
      setup.pragma("user_version = 2");
      setup.close();

      const db = initDb(tmpFile);

      // Non-UUID text IDs should now be converted to snowflakes
      const guild = db.prepare("SELECT id FROM guilds WHERE name = 'TestGuild'").get() as { id: string };
      expect(guild.id).toMatch(/^\d+$/);

      const ch = db.prepare("SELECT id, guild_id FROM channels WHERE name = 'general'").get() as { id: string; guild_id: string };
      expect(ch.id).toMatch(/^\d+$/);
      expect(ch.guild_id).toBe(guild.id);

      const user = db.prepare("SELECT id FROM users WHERE username = 'Luna'").get() as { id: string };
      expect(user.id).toMatch(/^\d+$/);

      // guild_members FKs should also be updated
      const member = db.prepare("SELECT guild_id, user_id FROM guild_members").get() as { guild_id: string; user_id: string };
      expect(member.guild_id).toBe(guild.id);
      expect(member.user_id).toBe(user.id);

      db.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("converts TEXT timestamps to INTEGER during migration", () => {
    const tmpFile = tmpDb();
    try {
      const setup = new Database(tmpFile);
      setup.pragma("journal_mode = WAL");
      setup.pragma("foreign_keys = OFF");
      // Real old databases have INTEGER-affinity columns (from createAllTables)
      // but contain TEXT values (ISO strings) because old code inserted strings.
      setup.exec(`
        CREATE TABLE guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, owner_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE channels (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, avatar TEXT, bot INTEGER NOT NULL DEFAULT 1, bio TEXT, token TEXT UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE guild_members (guild_id TEXT NOT NULL, user_id TEXT, nick TEXT, roles TEXT DEFAULT '[]', joined_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));
        CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT, sender TEXT, content TEXT, timestamp INTEGER, metadata TEXT, edited_timestamp INTEGER, sender_name TEXT);
        CREATE TABLE invite_codes (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER, used_by TEXT);
        CREATE TABLE pending_registrations (id TEXT PRIMARY KEY, pending_token TEXT UNIQUE NOT NULL, google_id TEXT, email TEXT, username TEXT, avatar TEXT, created_at INTEGER);
        CREATE TABLE read_states (user_id TEXT NOT NULL, channel_id TEXT NOT NULL, last_read_message_id TEXT, PRIMARY KEY (user_id, channel_id));
      `);

      const guildIso = "2024-11-14T22:13:20.000Z";
      const userIso = "2024-11-14T22:13:21.000Z";
      const msgIso = "2024-11-14T22:13:22.000Z";
      const editIso = "2024-11-14T22:13:23.000Z";
      const joinIso = "2024-11-14T22:13:21.500Z";
      const inviteIso = "2024-11-14T22:13:24.000Z";
      const usedAtIso = "2024-11-14T22:13:25.000Z";
      const pendingIso = "2024-11-14T22:13:26.000Z";

      setup.exec(`INSERT INTO guilds (id, name, created_at, updated_at) VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'TG', '${guildIso}', '${guildIso}')`);
      setup.exec(`INSERT INTO channels (id, guild_id, name) VALUES ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'general')`);
      setup.exec(`INSERT INTO users (id, username, bot, token, created_at, updated_at) VALUES ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'U1', 1, 'tok', '${userIso}', '${userIso}')`);
      setup.exec(`INSERT INTO guild_members (guild_id, user_id, joined_at) VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', '${joinIso}')`);
      setup.exec(`INSERT INTO messages (id, channel_id, sender, content, timestamp, edited_timestamp) VALUES ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'hello', '${msgIso}', '${editIso}')`);
      setup.exec(`INSERT INTO invite_codes (id, code, created_at, used_at) VALUES ('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 'ABC', '${inviteIso}', '${usedAtIso}')`);
      setup.exec(`INSERT INTO pending_registrations (id, pending_token, created_at) VALUES ('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', 'ptok', '${pendingIso}')`);
      setup.pragma("user_version = 2");
      setup.close();

      const db = initDb(tmpFile);

      // All timestamp columns should now be integers
      const guild = db.prepare("SELECT created_at, updated_at FROM guilds WHERE name = 'TG'").get() as { created_at: unknown; updated_at: unknown };
      expect(typeof guild.created_at).toBe("number");
      expect(guild.created_at).toBe(new Date(guildIso).getTime());
      expect(typeof guild.updated_at).toBe("number");

      const user = db.prepare("SELECT created_at, updated_at FROM users WHERE username = 'U1'").get() as { created_at: unknown; updated_at: unknown };
      expect(typeof user.created_at).toBe("number");
      expect(user.created_at).toBe(new Date(userIso).getTime());

      const msg = db.prepare("SELECT timestamp, edited_timestamp FROM messages WHERE content = 'hello'").get() as { timestamp: unknown; edited_timestamp: unknown };
      expect(typeof msg.timestamp).toBe("number");
      expect(msg.timestamp).toBe(new Date(msgIso).getTime());
      expect(typeof msg.edited_timestamp).toBe("number");
      expect(msg.edited_timestamp).toBe(new Date(editIso).getTime());

      const member = db.prepare("SELECT joined_at FROM guild_members").get() as { joined_at: unknown };
      expect(typeof member.joined_at).toBe("number");
      expect(member.joined_at).toBe(new Date(joinIso).getTime());

      const invite = db.prepare("SELECT created_at, used_at FROM invite_codes WHERE code = 'ABC'").get() as { created_at: unknown; used_at: unknown };
      expect(typeof invite.created_at).toBe("number");
      expect(invite.created_at).toBe(new Date(inviteIso).getTime());
      expect(typeof invite.used_at).toBe("number");
      expect(invite.used_at).toBe(new Date(usedAtIso).getTime());

      const pending = db.prepare("SELECT created_at FROM pending_registrations WHERE pending_token = 'ptok'").get() as { created_at: unknown };
      expect(typeof pending.created_at).toBe("number");
      expect(pending.created_at).toBe(new Date(pendingIso).getTime());

      db.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });
});

describe("V17→V18 attachments table migration", () => {
  it("creates attachments table when upgrading from v17 (JSON column)", () => {
    const tmpFile = tmpDb();
    try {
      // Simulate a DB that already ran old v17 (column addition)
      const db1 = initDb(tmpFile);
      // Downgrade version to 17 to simulate the old state
      db1.pragma("user_version = 17");
      // Verify the messages.attachments column exists (from v17)
      const cols = db1.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
      expect(cols.some(c => c.name === "attachments")).toBe(true);
      // Drop the attachments table if initDb created it (we want to test the upgrade)
      db1.exec("DROP TABLE IF EXISTS attachments");
      db1.close();

      // Re-open — should run v18 and create the attachments table
      const db2 = initDb(tmpFile);
      const version = db2.pragma("user_version", { simple: true });
      expect(version).toBe(20);

      const tables = db2.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='attachments'"
      ).all();
      expect(tables).toHaveLength(1);

      // Verify table schema
      const tableCols = db2.prepare("PRAGMA table_info(attachments)").all() as Array<{ name: string }>;
      const colNames = tableCols.map(c => c.name);
      expect(colNames).toContain("id");
      expect(colNames).toContain("message_id");
      expect(colNames).toContain("channel_id");
      expect(colNames).toContain("guild_id");
      expect(colNames).toContain("filename");
      expect(colNames).toContain("url");

      db2.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("migrates JSON attachment data from messages column to table", () => {
    const tmpFile = tmpDb();
    try {
      const db1 = initDb(tmpFile);
      db1.pragma("user_version = 17");
      db1.exec("DROP TABLE IF EXISTS attachments");

      // Insert a message with JSON attachments in the old column
      const guild = db1.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
      const channel = db1.prepare("SELECT id FROM channels LIMIT 1").get() as { id: string };
      const user = db1.prepare("SELECT id FROM users LIMIT 1").get() as { id: string };
      if (guild && channel && user) {
        const now = Date.now();
        db1.prepare(
          "INSERT INTO messages (id, channel_id, author_id, content, timestamp, attachments) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(
          "msg-test-1", channel.id, user.id, "test", now,
          JSON.stringify([{
            id: "att-1",
            filename: "photo.png",
            content_type: "image/png",
            size: 12345,
            url: `/api/v10/attachments/${guild.id}/${channel.id}/att-1/photo.png`
          }])
        );
      }
      db1.close();

      const db2 = initDb(tmpFile);
      expect(db2.pragma("user_version", { simple: true })).toBe(20);

      if (guild && channel) {
        const att = db2.prepare("SELECT * FROM attachments WHERE id = 'att-1'").get() as Record<string, unknown> | undefined;
        expect(att).toBeDefined();
        if (att) {
          expect(att.filename).toBe("photo.png");
          expect(att.content_type).toBe("image/png");
          expect(att.size).toBe(12345);
          expect(att.message_id).toBe("msg-test-1");
        }
      }

      db2.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });
});
