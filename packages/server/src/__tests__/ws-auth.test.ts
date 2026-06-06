/**
 * WebSocket authentication integration tests (BFF cookie-based + bot token).
 *
 * These tests start a real HTTP server with the gateway WebSocket endpoint
 * and verify the full IDENTIFY flow for browser (cookie) and bot (token) clients.
 *
 * PR #248 — BFF pattern: cookie auth for WebSocket upgrade.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import { WebSocket } from "ws";
import { initDb, seedChannels } from "../db/schema.js";
import { createApp } from "../app.js";
import { createRepos } from "../repos/index.js";
import { setupGateway, GatewayDispatcher } from "../ws/index.js";
import { GatewayOpcode } from "@cove/shared";
import type Database from "better-sqlite3";

// ─── Helpers ──────────────────────────────────────────────────────────────

type GatewayMsg = { op: number; d: unknown; s?: number | null; t?: string | null };

/**
 * Buffering message collector — attach to WebSocket IMMEDIATELY after creation
 * (before 'open') so no messages are lost to race conditions.
 */
class MessageCollector {
  private messages: GatewayMsg[] = [];
  private waiters: Array<{
    check: (msg: GatewayMsg) => boolean;
    resolve: (msg: GatewayMsg) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(ws: WebSocket) {
    ws.on("message", (raw: Buffer | string) => {
      const msg = JSON.parse(raw.toString()) as GatewayMsg;
      const idx = this.waiters.findIndex((w) => w.check(msg));
      if (idx >= 0) {
        const waiter = this.waiters.splice(idx, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      } else {
        this.messages.push(msg);
      }
    });
  }

  waitForOp(opcode: number, timeoutMs = 5000): Promise<GatewayMsg> {
    const idx = this.messages.findIndex((m) => m.op === opcode);
    if (idx >= 0) return Promise.resolve(this.messages.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.resolve === resolve);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`Timed out waiting for opcode ${opcode}`));
      }, timeoutMs);
      this.waiters.push({ check: (m) => m.op === opcode, resolve, timer });
    });
  }

  waitForEvent(eventName: string, timeoutMs = 5000): Promise<GatewayMsg> {
    const check = (m: GatewayMsg) => m.op === GatewayOpcode.DISPATCH && m.t === eventName;
    const idx = this.messages.findIndex(check);
    if (idx >= 0) return Promise.resolve(this.messages.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.resolve === resolve);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`Timed out waiting for event ${eventName}`));
      }, timeoutMs);
      this.waiters.push({ check, resolve, timer });
    });
  }
}

/** Wait for WS close with expected code. */
function waitForClose(ws: WebSocket, timeoutMs = 5000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for close")), timeoutMs);
    ws.on("close", (code: number, reason: Buffer) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

// ─── Test Suite ───────────────────────────────────────────────────────────

describe("WebSocket auth integration (BFF pattern)", () => {
  let db: Database.Database;
  let server: http.Server;
  let port: number;
  let clients: WebSocket[] = [];

  const TEST_TOKEN = "ws-test-token-abc123";
  const TEST_USER_ID = "ws-test-user";
  const TEST_USERNAME = "WSTestUser";

  function wsUrl(): string {
    return `ws://127.0.0.1:${port}/gateway`;
  }

  function connect(headers?: Record<string, string>): { ws: WebSocket; collector: MessageCollector } {
    const ws = new WebSocket(wsUrl(), { headers });
    const collector = new MessageCollector(ws);
    clients.push(ws);
    return { ws, collector };
  }

  function waitForOpen(ws: WebSocket, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) return resolve();
      const timer = setTimeout(() => reject(new Error("WS open timeout")), timeoutMs);
      ws.once("open", () => { clearTimeout(timer); resolve(); });
      ws.once("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }

  beforeEach(async () => {
    db = initDb(":memory:");
    const defaultGuildId = (
      db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }
    ).id;
    seedChannels(db, defaultGuildId);

    const repos = createRepos(db);
    const dispatcher = new GatewayDispatcher(repos.channels, repos.guilds);
    const app = createApp(db, repos, dispatcher);

    // Seed test user with known token
    const now = Date.now();
    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(TEST_USER_ID, TEST_USERNAME, null, 0, null, TEST_TOKEN, now, now);
    db.prepare(
      "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
    ).run(defaultGuildId, TEST_USER_ID, null, "[]", now);

    // Create HTTP server, attach WebSocket BEFORE listening (avoids race)
    server = createAdaptorServer({ fetch: app.fetch }) as http.Server;
    setupGateway(server, repos.users, repos.guilds, dispatcher, repos.readStates);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        port = addr.port;
        resolve();
      });
    });

    clients = [];
  });

  afterEach(async () => {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    clients = [];
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });

  // ─── 1. Browser flow: valid session cookie ───────────────────────────

  it("browser flow: valid session cookie + null token → READY", async () => {
    const { ws, collector } = connect({ Cookie: `cove-session=${TEST_TOKEN}` });
    await waitForOpen(ws);

    const hello = await collector.waitForOp(GatewayOpcode.HELLO);
    expect(hello.d).toHaveProperty("heartbeat_interval");

    // Browser sends IDENTIFY with null token — relies on cookie
    ws.send(JSON.stringify({ op: GatewayOpcode.IDENTIFY, d: { token: null } }));

    const ready = await collector.waitForEvent("READY");
    expect(ready.d).toHaveProperty("user");
    expect((ready.d as any).user.id).toBe(TEST_USER_ID);
    expect((ready.d as any).user.username).toBe(TEST_USERNAME);
    expect((ready.d as any).session_id).toBeTruthy();
  }, 10000);

  // ─── 2. Bot flow: no cookie + valid token ────────────────────────────

  it("bot flow: no cookie + valid token → READY", async () => {
    const { ws, collector } = connect();
    await waitForOpen(ws);

    await collector.waitForOp(GatewayOpcode.HELLO);

    ws.send(JSON.stringify({ op: GatewayOpcode.IDENTIFY, d: { token: TEST_TOKEN } }));

    const ready = await collector.waitForEvent("READY");
    expect((ready.d as any).user.id).toBe(TEST_USER_ID);
    expect((ready.d as any).user.username).toBe(TEST_USERNAME);
  }, 10000);

  // ─── 3. No cookie + null token → close 4001 ─────────────────────────

  it("no cookie + null token → close 4001 (Token required)", async () => {
    const { ws, collector } = connect();
    await waitForOpen(ws);

    await collector.waitForOp(GatewayOpcode.HELLO);

    const closePromise = waitForClose(ws);
    ws.send(JSON.stringify({ op: GatewayOpcode.IDENTIFY, d: { token: null } }));

    const { code, reason } = await closePromise;
    expect(code).toBe(4001);
    expect(reason).toBe("Token required");
  }, 10000);

  // ─── 4. No cookie + invalid token → close 4004 ──────────────────────

  it("no cookie + invalid token → close 4004 (Authentication failed)", async () => {
    const { ws, collector } = connect();
    await waitForOpen(ws);

    await collector.waitForOp(GatewayOpcode.HELLO);

    const closePromise = waitForClose(ws);
    ws.send(JSON.stringify({ op: GatewayOpcode.IDENTIFY, d: { token: "bad-token" } }));

    const { code, reason } = await closePromise;
    expect(code).toBe(4004);
    expect(reason).toBe("Authentication failed");
  }, 10000);

  // ─── 5. Malformed cookie → connection survives, token auth works ─────

  it("malformed cookie header → connection survives, bot token auth works", async () => {
    const { ws, collector } = connect({ Cookie: "cove-session=%invalid%encoding" });
    await waitForOpen(ws);

    // Should still receive HELLO — parseCookies gracefully handles malformed values
    const hello = await collector.waitForOp(GatewayOpcode.HELLO);
    expect(hello.d).toHaveProperty("heartbeat_interval");

    // Fall back to explicit token auth
    ws.send(JSON.stringify({ op: GatewayOpcode.IDENTIFY, d: { token: TEST_TOKEN } }));

    const ready = await collector.waitForEvent("READY");
    expect((ready.d as any).user.id).toBe(TEST_USER_ID);
  }, 10000);
});
