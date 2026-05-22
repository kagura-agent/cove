import type { Context, Next } from "hono";
import type Database from "better-sqlite3";

export interface BotUser {
  id: string;
  username: string;
  bot: true;
}

export function resolveBot(db: Database.Database, authHeader: string | undefined): BotUser | undefined {
  if (!authHeader?.startsWith("Bot ")) return undefined;
  const token = authHeader.slice(4).trim();
  if (!token) return undefined;
  const row = db.prepare("SELECT id, username FROM users WHERE token = ?").get(token) as { id: string; username: string } | undefined;
  if (!row) return undefined;
  return { id: row.id, username: row.username, bot: true };
}

export function requireBotAuth(db: Database.Database) {
  return async (c: Context, next: Next) => {
    const bot = resolveBot(db, c.req.header("Authorization"));
    if (!bot) {
      return c.json({ message: "Authentication required", code: 40001 }, 401);
    }
    c.set("botUser", bot);
    return next();
  };
}
