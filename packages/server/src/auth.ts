import type { Context, Next } from "hono";
import type Database from "better-sqlite3";

export interface AuthUser {
  id: string;
  username: string;
  bot: boolean;
}

export function resolveUser(db: Database.Database, authHeader: string | undefined): AuthUser | undefined {
  if (!authHeader) return undefined;

  let token: string | undefined;
  if (authHeader.startsWith("Bot ")) {
    token = authHeader.slice(4).trim();
  } else if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }
  if (!token) return undefined;

  const row = db.prepare("SELECT id, username, bot FROM users WHERE token = ?").get(token) as
    { id: string; username: string; bot: number } | undefined;
  if (!row) return undefined;
  return { id: row.id, username: row.username, bot: row.bot === 1 };
}

/** @deprecated Use resolveUser instead */
export function resolveBot(db: Database.Database, authHeader: string | undefined): AuthUser | undefined {
  return resolveUser(db, authHeader);
}

export function requireAuth(db: Database.Database) {
  return async (c: Context, next: Next) => {
    const user = resolveUser(db, c.req.header("Authorization"));
    if (!user) {
      return c.json({ message: "Authentication required", code: 40001 }, 401);
    }
    c.set("botUser", user);
    return next();
  };
}

/** @deprecated Use requireAuth instead */
export const requireBotAuth = requireAuth;
