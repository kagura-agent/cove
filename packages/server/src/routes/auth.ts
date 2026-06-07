import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import crypto from "node:crypto";
import { generateSnowflake } from "@cove/shared";
import type Database from "better-sqlite3";
import type { GuildsRepo } from "../repos/guilds.js";
import { SESSION_COOKIE, PENDING_COOKIE, COOKIE_OPTIONS, resolveUser } from "../auth.js";
import type { UsersRepo } from "../repos/users.js";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function authRoutes(db: Database.Database, config: OAuthConfig, guildsRepo: GuildsRepo, usersRepo: UsersRepo): Hono {
  const app = new Hono();

  app.get("/api/auth/google", (c) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });
    return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get("/api/auth/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) {
      return c.json({ message: "Missing authorization code", code: 50035 }, 400);
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      return c.json({ message: "Failed to exchange authorization code", code: 50035 }, 400);
    }

    const tokenData = await tokenRes.json() as { access_token: string };

    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      return c.json({ message: "Failed to fetch user info", code: 50035 }, 400);
    }

    const googleUser = await userRes.json() as {
      id: string;
      email: string;
      name: string;
      picture: string;
    };

    const now = Date.now();

    // Look up existing user by google_id first, then by email
    const existing = (
      db.prepare("SELECT id, token FROM users WHERE google_id = ?").get(googleUser.id) ??
      db.prepare("SELECT id, token FROM users WHERE email = ?").get(googleUser.email)
    ) as { id: string; token: string | null } | undefined;

    if (existing) {
      const token = existing.token ?? crypto.randomUUID();
      db.prepare("UPDATE users SET username = ?, avatar = ?, google_id = ?, email = ?, token = ?, updated_at = ? WHERE id = ?")
        .run(googleUser.name, googleUser.picture, googleUser.id, googleUser.email, token, now, existing.id);
      usersRepo.refreshTTL(existing.id);
      setCookie(c, SESSION_COOKIE, token, COOKIE_OPTIONS);
      return c.redirect("/");
    }

    // New user: store in pending_registrations, require invite code
    const pendingToken = crypto.randomUUID();
    db.prepare(
      "INSERT INTO pending_registrations (id, pending_token, google_id, email, username, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(generateSnowflake(), pendingToken, googleUser.id, googleUser.email, googleUser.name, googleUser.picture, now);

    setCookie(c, PENDING_COOKIE, pendingToken, COOKIE_OPTIONS);
    return c.redirect("/");
  });

  app.get("/api/auth/me", (c) => {
    const user = resolveUser(usersRepo, c.req.header("Authorization"), getCookie(c, SESSION_COOKIE));
    if (!user) {
      return c.json({ message: "Authentication required", code: 40001 }, 401);
    }
    return c.json({ id: user.id, username: user.username, avatar: user.avatar, bot: user.bot, expires_at: user.expires_at });
  });

  app.get("/api/auth/pending-status", (c) => {
    const pendingToken = getCookie(c, PENDING_COOKIE);
    if (!pendingToken) {
      return c.json({ pending: false });
    }
    const row = db.prepare(
      "SELECT id FROM pending_registrations WHERE pending_token = ?"
    ).get(pendingToken);
    if (!row) {
      // Cookie exists but token invalid — clean up
      deleteCookie(c, PENDING_COOKIE, { path: "/" });
      return c.json({ pending: false });
    }
    return c.json({ pending: true });
  });

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    deleteCookie(c, PENDING_COOKIE, { path: "/" });
    return c.json({ message: "ok" });
  });

  return app;
}
