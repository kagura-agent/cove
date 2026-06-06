import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { UsersRepo } from "./repos/users.js";

export interface AuthUser {
  id: string;
  username: string;
  avatar: string | null;
  bot: boolean;
}

export type AppEnv = { Variables: { botUser: AuthUser } };

/** Cookie name for authenticated session tokens */
export const SESSION_COOKIE = "cove-session";

/** Cookie name for pending registration tokens */
export const PENDING_COOKIE = "cove-pending";

/** Shared cookie options — secure by default, disabled only for explicit local dev */
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== "development",
  sameSite: "Lax" as const,
  path: "/",
  maxAge: 604800, // 7 days
};

/**
 * Resolve an authenticated user from an Authorization header or a raw cookie token.
 * The optional `cookieToken` parameter allows callers (like `requireAuth`) to pass
 * a token read from the session cookie.
 */
export function resolveUser(users: UsersRepo, authHeader: string | undefined, cookieToken?: string): AuthUser | undefined {
  let token: string | undefined;

  if (authHeader) {
    if (authHeader.startsWith("Bot ")) {
      token = authHeader.slice(4).trim();
    } else if (authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    }
  }

  // Fall back to cookie token when no valid Authorization header
  if (!token && cookieToken) {
    token = cookieToken;
  }

  if (!token) return undefined;

  const user = users.findByToken(token);
  if (!user) return undefined;
  return { id: user.id, username: user.username, avatar: user.avatar ?? null, bot: user.bot };
}

export function requireAuth(users: UsersRepo) {
  return async (c: Context, next: Next) => {
    const cookieToken = getCookie(c, SESSION_COOKIE);
    const user = resolveUser(users, c.req.header("Authorization"), cookieToken);
    if (!user) {
      return c.json({ message: "Authentication required", code: 40001 }, 401);
    }
    c.set("botUser", user);
    return next();
  };
}
