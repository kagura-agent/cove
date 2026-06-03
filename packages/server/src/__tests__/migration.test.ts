import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../db/schema.js";

describe("scenes→channels migration guard", () => {
  it("renames scenes to channels when channels does not exist", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, type TEXT, channel_id TEXT, description TEXT, position_x REAL, position_y REAL)`);
    db.exec(`INSERT INTO scenes (id, name) VALUES ('s1', 'Scene1')`);
    db.close();

    // initDb creates in-memory, so we simulate by manually creating the state then calling initDb
    // Instead, use a temp file
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmpFile = path.join(os.tmpdir(), `cove-test-${Date.now()}.db`);

    try {
      const setup = new Database(tmpFile);
      setup.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, type TEXT, channel_id TEXT, description TEXT, position_x REAL, position_y REAL)`);
      setup.exec(`INSERT INTO scenes (id, name) VALUES ('s1', 'Scene1')`);
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
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmpFile = path.join(os.tmpdir(), `cove-test-${Date.now()}.db`);

    try {
      const setup = new Database(tmpFile);
      setup.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, type TEXT, channel_id TEXT, description TEXT, position_x REAL, position_y REAL)`);
      setup.exec(`CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, type TEXT, channel_id TEXT, description TEXT, position_x REAL, position_y REAL)`);
      setup.exec(`INSERT INTO scenes (id, name) VALUES ('s1', 'OldData')`);
      setup.exec(`INSERT INTO channels (id, name) VALUES ('c1', 'NewData')`);
      setup.close();

      expect(() => initDb(tmpFile)).toThrow(/Migration conflict/);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it("keeps new table data when old table is empty", () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmpFile = path.join(os.tmpdir(), `cove-test-${Date.now()}.db`);

    try {
      const setup = new Database(tmpFile);
      setup.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, type TEXT, channel_id TEXT, description TEXT, position_x REAL, position_y REAL)`);
      setup.exec(`CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, type TEXT, channel_id TEXT, description TEXT, position_x REAL, position_y REAL)`);
      setup.exec(`INSERT INTO channels (id, name) VALUES ('c1', 'NewData')`);
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
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmpFile = path.join(os.tmpdir(), `cove-test-${Date.now()}.db`);

    try {
      const setup = new Database(tmpFile);
      setup.exec(`CREATE TABLE scenes (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, type TEXT, channel_id TEXT, description TEXT, position_x REAL, position_y REAL)`);
      setup.exec(`CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, type TEXT, channel_id TEXT, description TEXT, position_x REAL, position_y REAL)`);
      setup.exec(`INSERT INTO scenes (id, name) VALUES ('s1', 'OldData')`);
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
