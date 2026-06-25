import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import { API_PREFIX, PermissionFlags } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";

describe("Channel Files API", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let defaultGuildId: string;
  let generalId: string;

  class TestDispatcher extends GatewayDispatcher {
    constructor() {
      super({ getById: () => null } as any);
    }
  }

  beforeEach(() => {
    db = initDb(":memory:");
    defaultGuildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, defaultGuildId);
    generalId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;
    process.env.RATE_LIMIT_ENABLED = "false";
    app = createApp(db, createRepos(db), new TestDispatcher());

    adminToken = "test-admin-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("admin", "Admin", null, 0, null, adminToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "admin", null, "[]", now);
    db.prepare("UPDATE guilds SET owner_id = ? WHERE id = ?").run("admin", defaultGuildId);
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_ENABLED;
  });

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken}`,
  });

  // ─── CRUD Operations ───────────────────────────────────────────────────

  describe("CRUD operations", () => {
    it("creates a file with PUT", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/hello.md`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "# Hello World" }),
      });
      expect(res.status).toBe(200);
      const file = await res.json();
      expect(file.filename).toBe("hello.md");
      expect(file.content).toBe("# Hello World");
      expect(file.channel_id).toBe(generalId);
      expect(file.size).toBeGreaterThan(0);
      expect(file.content_type).toBe("text/plain");
      expect(typeof file.created_at).toBe("number");
      expect(typeof file.updated_at).toBe("number");
    });

    it("reads a file with GET", async () => {
      await app.request(`${API_PREFIX}/channels/${generalId}/files/readme.md`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "Read me!" }),
      });

      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/readme.md`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const file = await res.json();
      expect(file.filename).toBe("readme.md");
      expect(file.content).toBe("Read me!");
    });

    it("updates a file with PUT", async () => {
      await app.request(`${API_PREFIX}/channels/${generalId}/files/notes.txt`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "v1" }),
      });
      const res1 = await app.request(`${API_PREFIX}/channels/${generalId}/files/notes.txt`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const original = await res1.json();

      const res2 = await app.request(`${API_PREFIX}/channels/${generalId}/files/notes.txt`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "v2" }),
      });
      expect(res2.status).toBe(200);
      const updated = await res2.json();
      expect(updated.content).toBe("v2");
      expect(updated.created_at).toBe(original.created_at);
      expect(updated.updated_at).toBeGreaterThanOrEqual(original.updated_at);
    });

    it("deletes a file and returns 204", async () => {
      await app.request(`${API_PREFIX}/channels/${generalId}/files/deleteme.txt`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "bye" }),
      });

      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/deleteme.txt`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(204);

      // Verify file is gone
      const getRes = await app.request(`${API_PREFIX}/channels/${generalId}/files/deleteme.txt`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(getRes.status).toBe(404);
    });
  });

  // ─── List with cove.md sorting ─────────────────────────────────────────

  describe("List files", () => {
    it("lists files with cove.md first", async () => {
      await app.request(`${API_PREFIX}/channels/${generalId}/files/bbb.txt`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "b" }),
      });
      await app.request(`${API_PREFIX}/channels/${generalId}/files/aaa.txt`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "a" }),
      });
      await app.request(`${API_PREFIX}/channels/${generalId}/files/cove.md`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "# Channel Context" }),
      });

      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const files = await res.json();
      expect(files).toHaveLength(3);
      expect(files[0].filename).toBe("cove.md");
      expect(files[1].filename).toBe("aaa.txt");
      expect(files[2].filename).toBe("bbb.txt");
      // List should not include content
      expect(files[0]).not.toHaveProperty("content");
    });

    it("returns empty array for channel with no files", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const files = await res.json();
      expect(files).toEqual([]);
    });
  });

  // ─── Auth required ─────────────────────────────────────────────────────

  describe("Authentication", () => {
    it("returns 401 without auth token", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files`);
      expect(res.status).toBe(401);
    });

    it("returns 401 for PUT without auth", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/test.txt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hack" }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 for DELETE without auth", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/test.txt`, {
        method: "DELETE",
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── Non-member access ─────────────────────────────────────────────────

  describe("Non-member access", () => {
    let outsiderToken: string;

    beforeEach(() => {
      const now = Date.now();
      outsiderToken = "outsider-files-token";
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("outsider", "Outsider", null, 1, null, outsiderToken, now, now);
      // NOT added to guild_members
    });

    it("non-member cannot list files", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files`, {
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot get file", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/cove.md`, {
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot create file", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/hack.txt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bot ${outsiderToken}` },
        body: JSON.stringify({ content: "hacked" }),
      });
      expect(res.status).toBe(404);
    });

    it("non-member cannot delete file", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/test.txt`, {
        method: "DELETE",
        headers: { Authorization: `Bot ${outsiderToken}` },
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Filename validation ───────────────────────────────────────────────

  describe("Filename validation", () => {
    it("rejects filenames starting with dot", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/.hidden`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "secret" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects filenames with spaces", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/my%20file.txt`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "content" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects filenames with path separators", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/..%2F..%2Fetc%2Fpasswd`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "evil" }),
      });
      expect(res.status).toBe(400);
    });

    it("accepts valid filenames", async () => {
      const validNames = ["cove.md", "README.txt", "config-v2.json", "notes_2024.md", "a"];
      for (const name of validNames) {
        const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/${name}`, {
          method: "PUT",
          headers: authHeaders(),
          body: JSON.stringify({ content: `content for ${name}` }),
        });
        expect(res.status).toBe(200);
      }
    });
  });

  // ─── Size limit ─────────────────────────────────────────────────────────

  describe("Size limit", () => {
    it("rejects files over 100KB", async () => {
      const bigContent = "x".repeat(100 * 1024 + 1);
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/big.txt`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: bigContent }),
      });
      expect(res.status).toBe(400);
    });

    it("accepts files at exactly 100KB", async () => {
      const content = "x".repeat(100 * 1024);
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/exact.txt`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content }),
      });
      expect(res.status).toBe(200);
    });
  });

  // ─── 404 cases ──────────────────────────────────────────────────────────

  describe("404 cases", () => {
    it("GET returns 404 for non-existent file", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/nonexistent.txt`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("DELETE returns 404 for non-existent file", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/nonexistent.txt`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent channel", async () => {
      const res = await app.request(`${API_PREFIX}/channels/nonexistent/files`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Content type ───────────────────────────────────────────────────────

  describe("Content type", () => {
    it("supports custom content_type", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/data.json`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: '{"key":"value"}', content_type: "application/json" }),
      });
      expect(res.status).toBe(200);
      const file = await res.json();
      expect(file.content_type).toBe("application/json");
    });
  });

  // ─── Bot permission overwrite ───────────────────────────────────────────

  describe("Bot with VIEW_CHANNEL denied", () => {
    let botToken: string;

    beforeEach(async () => {
      const now = Date.now();
      botToken = "bot-denied-token";
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("bot-denied", "DeniedBot", null, 1, null, botToken, now, now);
      db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
        .run(defaultGuildId, "bot-denied", null, "[]", now);
      // Explicitly deny VIEW_CHANNEL
      await app.request(`${API_PREFIX}/channels/${generalId}/permissions/bot-denied`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ type: 1, allow: "0", deny: PermissionFlags.VIEW_CHANNEL }),
      });
    });

    it("denied bot cannot list files", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      expect(res.status).toBe(403);
    });

    it("denied bot cannot get file", async () => {
      // Create a file first as admin
      await app.request(`${API_PREFIX}/channels/${generalId}/files/cove.md`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "secret context" }),
      });
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/cove.md`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      expect(res.status).toBe(403);
    });

    it("denied bot cannot create file", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/test.md`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bot ${botToken}` },
        body: JSON.stringify({ content: "injected content" }),
      });
      expect(res.status).toBe(403);
    });

    it("denied bot cannot delete file", async () => {
      // Create a file first as admin
      await app.request(`${API_PREFIX}/channels/${generalId}/files/test.md`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ content: "content" }),
      });
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files/test.md`, {
        method: "DELETE",
        headers: { Authorization: `Bot ${botToken}` },
      });
      expect(res.status).toBe(403);
    });
  });

  // ─── Bot with VIEW_CHANNEL granted ─────────────────────────────────────

  describe("Bot with VIEW_CHANNEL granted", () => {
    let botToken: string;

    beforeEach(async () => {
      const now = Date.now();
      botToken = "bot-allowed-token";
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("bot-allowed", "AllowedBot", null, 1, null, botToken, now, now);
      db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
        .run(defaultGuildId, "bot-allowed", null, "[]", now);
      // Grant VIEW_CHANNEL
      await app.request(`${API_PREFIX}/channels/${generalId}/permissions/bot-allowed`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ type: 1, allow: PermissionFlags.VIEW_CHANNEL, deny: "0" }),
      });
    });

    it("granted bot can list files", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/files`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      expect(res.status).toBe(200);
    });

    it("granted bot can create and read files", async () => {
      const createRes = await app.request(`${API_PREFIX}/channels/${generalId}/files/bot-file.md`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bot ${botToken}` },
        body: JSON.stringify({ content: "bot content" }),
      });
      expect(createRes.status).toBe(200);

      const getRes = await app.request(`${API_PREFIX}/channels/${generalId}/files/bot-file.md`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      expect(getRes.status).toBe(200);
      const file = await getRes.json();
      expect(file.content).toBe("bot content");
    });
  });
});
