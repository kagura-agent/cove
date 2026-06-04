import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../db/schema.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("scenes→channels migration guard", () => {
  it("renames scenes to channels when channels does not exist", () => {
    const tmpFile = path.join(os.tmpdir(), `cove-test-${Date.now()}.db`);

    try {
      const setup = new Database(tmpFile);
      setup.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, guild_id TEXT, name TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 0, topic TEXT, position INTEGER NOT NULL DEFAULT 0)`);
      setup.exec(`INSERT INTO scenes (id, guild_id, name) VALUES ('s1', 'g1', 'Scene1')`);
      setup.close();

      const db2 = initDb(tmpFile);
      const rows = db2.prepare("SELECT id, name FROM channels WHERE id = 's1'").all() as { id: string; name: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Scene1");
      db2.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("throws when both tables have data", () => {
    const tmpFile = path.join(os.tmpdir(), `cove-test-${Date.now()}.db`);

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
    const tmpFile = path.join(os.tmpdir(), `cove-test-${Date.now()}.db`);

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
    const tmpFile = path.join(os.tmpdir(), `cove-test-${Date.now()}.db`);

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
    const tmpFile = path.join(os.tmpdir(), `cove-test-${Date.now()}.db`);

    try {
      const setup = new Database(tmpFile);
      // Create old-style schema with island fields
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

      // Verify channels were migrated
      const rows = db2.prepare("SELECT * FROM channels ORDER BY position").all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);

      // Check new schema fields exist
      expect(rows[0]).toHaveProperty("type");
      expect(rows[0]).toHaveProperty("topic");
      expect(rows[0]).toHaveProperty("position");

      // Check old fields are gone
      expect(rows[0]).not.toHaveProperty("icon");
      expect(rows[0]).not.toHaveProperty("position_x");
      expect(rows[0]).not.toHaveProperty("position_y");
      expect(rows[0]).not.toHaveProperty("channel_id");
      expect(rows[0]).not.toHaveProperty("description");

      // Verify data was mapped correctly
      expect(rows[0].type).toBe(0);
      expect(rows[0].topic).toBe("Living room"); // description → topic

      db2.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("drops channel_state table", () => {
    const tmpFile = path.join(os.tmpdir(), `cove-test-${Date.now()}.db`);

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

      // Verify channel_state is gone
      const tables = db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channel_state'").all();
      expect(tables).toHaveLength(0);

      db2.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });
});
