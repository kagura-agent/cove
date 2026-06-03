import type { Context, Next } from "hono";
import type { UsersRepo } from "./repos/users.js";

export interface AuthUser {
  id: string;
  username: string;
  bot: boolean;
}

export type AppEnv = { Variables: { botUser: AuthUser } };

export function resolveUser(users: UsersRepo, authHeader: string | undefined): AuthUser | undefined {
  if (!authHeader) return undefined;

  let token: string | undefined;
  if (authHeader.startsWith("Bot ")) {
    token = authHeader.slice(4).trim();
  } else if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }
  if (!token) return undefined;

  const user = users.findByToken(token);
  if (!user) return undefined;
  return { id: user.id, username: user.username, bot: user.bot };
}

export function requireAuth(users: UsersRepo) {
  return async (c: Context, next: Next) => {
    const user = resolveUser(users, c.req.header("Authorization"));
    if (!user) {
      return c.json({ message: "Authentication required", code: 40001 }, 401);
    }
    c.set("botUser", user);
    return next();
  };
}
