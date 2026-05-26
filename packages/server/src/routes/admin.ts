import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateCode(): string {
  let part1 = "";
  let part2 = "";
  for (let i = 0; i < 4; i++) {
    part1 += CHARS[Math.floor(Math.random() * CHARS.length)];
    part2 += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return `COVE-${part1}-${part2}`;
}

export function adminRoutes(db: Database.Database): Hono {
  const app = new Hono();

  app.post("/api/v10/admin/invite-codes", async (c) => {
    const body = await c.req.json<{ count?: number }>();
    const count = body.count ?? 1;

    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return c.json({ message: "count must be an integer between 1 and 50" }, 400);
    }

    const insert = db.prepare(
      "INSERT INTO invite_codes (id, code, created_at) VALUES (?, ?, ?)"
    );
    const now = Date.now();
    const codes: string[] = [];

    for (let i = 0; i < count; i++) {
      const code = generateCode();
      insert.run(randomUUID(), code, now);
      codes.push(code);
    }

    return c.json({ codes });
  });

  app.post("/api/v10/auth/register", async (c) => {
    const body = await c.req.json<{ inviteCode?: string; pendingToken?: string }>();
    const { inviteCode, pendingToken } = body;

    if (!inviteCode || !pendingToken) {
      return c.json({ message: "inviteCode and pendingToken are required" }, 400);
    }

    const code = db.prepare("SELECT id FROM invite_codes WHERE code = ? AND used_at IS NULL").get(inviteCode) as { id: string } | undefined;
    if (!code) {
      return c.json({ message: "Invalid or already used invite code" }, 400);
    }

    const pending = db.prepare(
      "SELECT id, google_id, email, username, avatar FROM pending_registrations WHERE pending_token = ?"
    ).get(pendingToken) as { id: string; google_id: string; email: string; username: string; avatar: string } | undefined;
    if (!pending) {
      return c.json({ message: "Invalid pending token" }, 400);
    }

    const userId = pending.email.split("@")[0];
    const now = Date.now();
    const token = randomUUID();

    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(userId, pending.username, pending.avatar, 0, null, token, now, now);

    db.prepare("UPDATE invite_codes SET used_at = ?, used_by = ? WHERE id = ?").run(now, userId, code.id);
    db.prepare("DELETE FROM pending_registrations WHERE id = ?").run(pending.id);

    return c.json({ token });
  });

  return app;
}
