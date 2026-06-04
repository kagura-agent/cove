import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../db/schema.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function tmpDb(): string {
  return path.join(os.tmpdir(), `cove-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("versioned migration system", () => {
  it("fresh DB gets user_version = 2", () => {
    const db = initDb();
    const version = db.pragma("user_version", { simple: true });
    expect(version).toBe(2);
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
      expect(version).toBe(2);

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='read_states'").all();
      expect(tables).toHaveLength(1);

      // Verify the table works
      db.prepare("INSERT INTO read_states (user_id, channel_id, last_read_message_id) VALUES (?, ?, ?)").run("u1", "ch1", "msg1");
      const row = db.prepare("SELECT * FROM read_states WHERE user_id = 'u1'").get() as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.last_read_message_id).toBe("msg1");

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
      const msg = db.prepare("SELECT * FROM messages WHERE id = 'm1'").get() as Record<string, unknown>;
      expect(msg).toBeDefined();
      expect(msg.content).toBe("hello");
      const version = db.pragma("user_version", { simple: true });
      expect(version).toBe(2);
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
      setup.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`INSERT INTO scenes (id, guild_id, name) VALUES ('s1', 'g1', 'Scene1')`);
      setup.close();

      const db2 = initDb(tmpFile);
      const rows = db2.prepare("SELECT id, name FROM channels WHERE id = 's1'").all() as { id: string; name: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Scene1");

      const version = db2.pragma("user_version", { simple: true });
      expect(version).toBe(2);
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
      setup.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`CREATE TABLE channels (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`INSERT INTO channels (id, guild_id, name) VALUES ('c1', 'g1', 'NewData')`);
      setup.close();

      const db2 = initDb(tmpFile);
      const rows = db2.prepare("SELECT id, name FROM channels WHERE id = 'c1'").all() as { id: string; name: string }[];
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
      setup.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`CREATE TABLE channels (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`INSERT INTO scenes (id, guild_id, name) VALUES ('s1', 'g1', 'OldData')`);
      setup.close();

      const db2 = initDb(tmpFile);
      const rows = db2.prepare("SELECT id, name FROM channels WHERE id = 's1'").all() as { id: string; name: string }[];
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
      expect(version).toBe(2);

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
