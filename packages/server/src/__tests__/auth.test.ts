import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import { API_PREFIX } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";
import type { OAuthConfig } from "../routes/auth.js";

describe("Auth endpoints (BFF pattern)", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let defaultGuildId: string;

  const oauthConfig: OAuthConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/api/auth/callback",
  };

  class TestDispatcher extends GatewayDispatcher {
    constructor() {
      super({ getById: () => null } as any);
    }
  }

  beforeEach(() => {
    db = initDb(":memory:");
    defaultGuildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, defaultGuildId);
    const repos = createRepos(db);
    app = createApp(db, repos, new TestDispatcher(), { oauth: oauthConfig });

    adminToken = "test-admin-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("admin", "Admin", null, 1, null, adminToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "admin", null, "[]", now);
  });

  function seedPending(id: string, token: string, email: string, username: string) {
    db.prepare(
      "INSERT INTO pending_registrations (id, pending_token, google_id, email, username, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, token, `google-${id}`, email, username, null, Date.now());
  }

  function seedInviteCode(code: string) {
    db.prepare("INSERT INTO invite_codes (id, code, created_at) VALUES (?, ?, ?)")
      .run(`inv-${code}`, code, Date.now());
  }

  // ─── GET /api/auth/pending-status ─────────────────────────────────────

  describe("GET /api/auth/pending-status", () => {
    it("returns { pending: false } when no cookie", async () => {
      const res = await app.request("/api/auth/pending-status");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ pending: false });
    });

    it("returns { pending: true } with valid pending cookie (no token leaked)", async () => {
      seedPending("p1", "pending-tok-1", "user@example.com", "PendingUser");

      const res = await app.request("/api/auth/pending-status", {
        headers: { Cookie: "cove-pending=pending-tok-1" },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ pending: true });
      expect(data).not.toHaveProperty("pendingToken");
    });

    it("returns { pending: false } and clears stale cookie", async () => {
      const res = await app.request("/api/auth/pending-status", {
        headers: { Cookie: "cove-pending=stale-token-xyz" },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ pending: false });

      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("cove-pending");
    });

    it("is accessible without session auth (public path)", async () => {
      const res = await app.request("/api/auth/pending-status");
      expect(res.status).toBe(200);
    });
  });

  // ─── POST /api/auth/logout ────────────────────────────────────────────

  describe("POST /api/auth/logout", () => {
    it("returns ok", async () => {
      const res = await app.request("/api/auth/logout", { method: "POST" });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ message: "ok" });
    });

    it("clears cookies in response", async () => {
      const res = await app.request("/api/auth/logout", {
        method: "POST",
        headers: { Cookie: "cove-session=some-token; cove-pending=some-pending" },
      });
      expect(res.status).toBe(200);

      const setCookieHeader = res.headers.get("set-cookie") ?? "";
      expect(setCookieHeader).toContain("cove-session");
      expect(setCookieHeader).toContain("cove-pending");
    });

    it("is accessible without session auth (public path)", async () => {
      const res = await app.request("/api/auth/logout", { method: "POST" });
      expect(res.status).toBe(200);
    });
  });

  // ─── requireAuth accepts session cookie ───────────────────────────────

  describe("requireAuth with session cookie", () => {
    it("accepts session cookie instead of Authorization header", async () => {
      const generalId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;

      const res = await app.request(`${API_PREFIX}/channels/${generalId}`, {
        headers: { Cookie: `cove-session=${adminToken}` },
      });
      expect(res.status).toBe(200);
      const ch = await res.json();
      expect(ch.name).toBe("general");
    });

    it("rejects request with no auth header and no cookie", async () => {
      const generalId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;

      const res = await app.request(`${API_PREFIX}/channels/${generalId}`);
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /api/auth/me — Bot prefix support ───────────────────────────

  describe("GET /api/auth/me", () => {
    it("works with Bearer prefix", async () => {
      const res = await app.request("/api/auth/me", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("admin");
    });

    it("works with Bot prefix", async () => {
      const res = await app.request("/api/auth/me", {
        headers: { Authorization: `Bot ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("admin");
    });

    it("works with session cookie", async () => {
      const res = await app.request("/api/auth/me", {
        headers: { Cookie: `cove-session=${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("admin");
    });

    it("returns 401 with no credentials", async () => {
      const res = await app.request("/api/auth/me");
      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid token", async () => {
      const res = await app.request("/api/auth/me", {
        headers: { Authorization: "Bearer invalid-token" },
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── Register reads pendingToken from cookie ──────────────────────────

  describe("POST /api/v10/auth/register — BFF cookie flow", () => {
    it("reads pendingToken from cookie instead of body", async () => {
      seedInviteCode("COVE-COOK-AA01");
      seedPending("pc1", "cookie-tok-1", "cookieuser@example.com", "CookieUser");

      const res = await app.request(`${API_PREFIX}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "cove-pending=cookie-tok-1",
        },
        body: JSON.stringify({ inviteCode: "COVE-COOK-AA01" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ message: "registered" });
      expect(data).not.toHaveProperty("token");
    });

    it("sets session cookie and clears pending cookie on success", async () => {
      seedInviteCode("COVE-COOK-BB02");
      seedPending("pc2", "cookie-tok-2", "cookieuser2@example.com", "CookieUser2");

      const res = await app.request(`${API_PREFIX}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "cove-pending=cookie-tok-2",
        },
        body: JSON.stringify({ inviteCode: "COVE-COOK-BB02" }),
      });
      expect(res.status).toBe(200);

      const setCookieHeader = res.headers.get("set-cookie") ?? "";
      expect(setCookieHeader).toContain("cove-session");
      expect(setCookieHeader).toContain("cove-pending");
    });
  });
});
