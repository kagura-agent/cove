import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { UsersRepo } from "./repos/users.js";

export interface AuthUser {
  id: string;
  username: string;
  avatar: string | null;
  bot: boolean;
  discriminator: string;
  global_name: string | null;
  expires_at: number | null;
}

export type AppEnv = { Variables: { botUser: AuthUser } };

/** Cookie name for authenticated session tokens */
export const SESSION_COOKIE = "cove-session";

/** Cookie name for pending registration tokens */
export const PENDING_COOKIE = "cove-pending";

import { SESSION_TTL_MS } from "./repos/users.js";

/** Shared cookie options — secure by default, disabled only for explicit local dev */
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== "development",
  sameSite: "Lax" as const,
  path: "/",
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
};

/**
 * Resolve an authenticated user from an Authorization header or a raw cookie token.
 * The optional `cookieToken` parameter allows callers (like `requireAuth`) to pass
 * a token read from the session cookie.
 */
export function resolveUser(users: UsersRepo, authHeader: string | undefined, cookieToken?: string): { user: AuthUser; refreshed: boolean } | undefined {
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

  // Sliding refresh: extend TTL if more than 1 day has passed since last refresh
  // Only for non-bot users with an expiry set
  let refreshed = false;
  if (user.expires_at !== null && !user.bot) {
    const remainingMs = user.expires_at - Date.now();
    const refreshThreshold = Math.max(SESSION_TTL_MS / 2, SESSION_TTL_MS - 86_400_000);
    if (remainingMs < refreshThreshold) {
      users.refreshTTL(user.id);
      refreshed = true;
    }
  }

  return { user: { id: user.id, username: user.username, avatar: user.avatar ?? null, bot: user.bot, discriminator: "0", global_name: null, expires_at: user.expires_at }, refreshed };
}

export function requireAuth(users: UsersRepo) {
  return async (c: Context, next: Next) => {
    const cookieToken = getCookie(c, SESSION_COOKIE);
    const result = resolveUser(users, c.req.header("Authorization"), cookieToken);
    if (!result) {
      return c.json({ message: "Authentication required", code: 40001 }, 401);
    }
    if (result.refreshed && cookieToken) {
      setCookie(c, SESSION_COOKIE, cookieToken, COOKIE_OPTIONS);
    }
    c.set("botUser", result.user);
    return next();
  };
}
