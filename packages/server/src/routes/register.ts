import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

/**
 * Invite-code registration route.
 * Public endpoint — no auth required (new users after OAuth).
 * Mounted independently of OAuth config so it's always available.
 */
export function registerRoutes(db: Database.Database): Hono {
  const app = new Hono();

  app.post("/api/v10/auth/register", async (c) => {
    const body = await c.req.json<{ inviteCode?: string; pendingToken?: string }>();
    const { inviteCode, pendingToken } = body;

    if (!inviteCode || !pendingToken) {
      return c.json({ message: "inviteCode and pendingToken are required" }, 400);
    }

    const normalizedCode = inviteCode.trim().toUpperCase();

    const code = db.prepare("SELECT id FROM invite_codes WHERE code = ? AND used_at IS NULL").get(normalizedCode) as { id: string } | undefined;
    if (!code) {
      return c.json({ message: "Invalid or already used invite code" }, 400);
    }

    const pending = db.prepare(
      "SELECT id, google_id, email, username, avatar FROM pending_registrations WHERE pending_token = ?"
    ).get(pendingToken) as { id: string; google_id: string; email: string; username: string; avatar: string } | undefined;
    if (!pending) {
      return c.json({ message: "Invalid pending token" }, 400);
    }

    const userId = randomUUID();
    const now = Date.now();
    const token = randomUUID();

    const register = db.transaction(() => {
      db.prepare(
        "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(userId, pending.username, pending.avatar, 0, null, token, now, now);

      // Add new user to default guild
      db.prepare(
        "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
      ).run("cove", userId, null, "[]", now);

      db.prepare("UPDATE invite_codes SET used_at = ?, used_by = ? WHERE id = ?").run(now, userId, code.id);
      db.prepare("DELETE FROM pending_registrations WHERE id = ?").run(pending.id);
    });
    register();

    return c.json({ token });
  });

  return app;
}
