import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function authRoutes(db: Database.Database, config: OAuthConfig): Hono {
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
      return c.json({ message: "Missing authorization code" }, 400);
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
      return c.json({ message: "Failed to exchange authorization code" }, 400);
    }

    const tokenData = await tokenRes.json() as { access_token: string };

    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      return c.json({ message: "Failed to fetch user info" }, 400);
    }

    const googleUser = await userRes.json() as {
      id: string;
      email: string;
      name: string;
      picture: string;
    };

    const userId = googleUser.email.split("@")[0];
    const now = Date.now();
    const existing = db.prepare("SELECT id, token FROM users WHERE id = ?").get(userId) as { id: string; token: string | null } | undefined;

    let token: string;
    if (existing) {
      token = existing.token ?? randomUUID();
      db.prepare("UPDATE users SET username = ?, avatar = ?, token = ?, updated_at = ? WHERE id = ?")
        .run(googleUser.name, googleUser.picture, token, now, userId);
    } else {
      token = randomUUID();
      db.prepare(
        "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(userId, googleUser.name, googleUser.picture, 0, null, token, now, now);
    }

    return c.redirect(`/?token=${token}`);
  });

  app.get("/api/auth/me", (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ message: "Authentication required", code: 40001 }, 401);
    }
    const token = authHeader.slice(7).trim();
    const row = db.prepare("SELECT id, username, avatar, bot FROM users WHERE token = ?").get(token) as
      { id: string; username: string; avatar: string | null; bot: number } | undefined;
    if (!row) {
      return c.json({ message: "Invalid token", code: 40001 }, 401);
    }
    return c.json({ id: row.id, username: row.username, avatar: row.avatar, bot: row.bot === 1 });
  });

  return app;
}
