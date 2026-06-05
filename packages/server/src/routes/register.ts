import { Hono } from "hono";
import crypto from "node:crypto";
import { generateSnowflake } from "@cove/shared";
import type Database from "better-sqlite3";
import type { GuildsRepo } from "../repos/guilds.js";

/**
 * Invite-code registration route.
 * Public endpoint — no auth required (new users after OAuth).
 * Mounted independently of OAuth config so it's always available.
 */
export function registerRoutes(db: Database.Database, guildsRepo: GuildsRepo): Hono {
  const app = new Hono();

  app.post("/auth/register", async (c) => {
    const body = await c.req.json<{ inviteCode?: string; pendingToken?: string }>();
    const { inviteCode, pendingToken } = body;

    if (!inviteCode || !pendingToken) {
      return c.json({ message: "inviteCode and pendingToken are required", code: 50035 }, 400);
    }

    const normalizedCode = inviteCode.trim().toUpperCase();

    const pending = db.prepare(
      "SELECT id, google_id, email, username, avatar FROM pending_registrations WHERE pending_token = ?"
    ).get(pendingToken) as { id: string; google_id: string; email: string; username: string; avatar: string } | undefined;
    if (!pending) {
      return c.json({ message: "Invalid pending token", code: 50035 }, 400);
    }

    const userId = generateSnowflake();
    const now = Date.now();
    const token = crypto.randomUUID();

    const register = db.transaction(() => {
      // Verify invite code is valid and unused (without consuming yet)
      const invite = db.prepare(
        "SELECT id FROM invite_codes WHERE code = ? AND used_at IS NULL"
      ).get(normalizedCode) as { id: string } | undefined;

      if (!invite) {
        return null; // code invalid or already used
      }

      db.prepare(
        "INSERT INTO users (id, username, avatar, bot, bio, token, google_id, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(userId, pending.username, pending.avatar, 0, null, token, pending.google_id, pending.email, now, now);

      // Add new user to default guild
      db.prepare(
        "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
      ).run(guildsRepo.getDefaultId(), userId, null, "[]", now);

      // #209: Atomic invite consumption — conditional UPDATE (race-safe within transaction)
      const inviteResult = db.prepare(
        "UPDATE invite_codes SET used_at = ?, used_by = ? WHERE code = ? AND used_at IS NULL"
      ).run(now, userId, normalizedCode);

      if (inviteResult.changes === 0) {
        // Shouldn't happen within transaction, but guard anyway
        return null;
      }

      db.prepare("DELETE FROM pending_registrations WHERE id = ?").run(pending.id);

      return token;
    });
    const result = register();

    if (result === null) {
      return c.json({ message: "Invalid or already used invite code", code: 50035 }, 400);
    }

    return c.json({ token: result });
  });

  return app;
}
