import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CoveAgent, CoveGuildMember } from "@cove/shared";

const GUILD_ID = "cove";

interface UserRow {
  id: string;
  username: string;
  avatar: string | null;
  bot: number;
  bio: string | null;
  token: string | null;
  created_at: number;
  updated_at: number;
}

interface GuildMemberRow {
  guild_id: string;
  user_id: string;
  nick: string | null;
  roles: string;
  joined_at: number;
}

function toUser(row: UserRow): CoveAgent {
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    bot: row.bot === 1,
    bio: row.bio,
  };
}

function toGuildMember(userRow: UserRow, memberRow: GuildMemberRow): CoveGuildMember {
  return {
    user: toUser(userRow),
    nick: memberRow.nick,
    roles: JSON.parse(memberRow.roles),
    joined_at: new Date(memberRow.joined_at).toISOString(),
  };
}

export function agentRoutes(db: Database.Database): Hono {
  const app = new Hono();

  // ─── Users (Discord-compatible) ─────────────────────────────────────────

  /** POST /api/v10/users — create a new bot user (Cove extension). */
  app.post("/api/v10/users", async (c) => {
    const body = await c.req.json<{
      id?: string;
      username: string;
      avatar?: string;
      bot?: boolean;
      bio?: string;
    }>();

    const username = body.username?.trim();
    if (!username) {
      return c.json({ message: "Username is required" }, 400);
    }

    const id = body.id?.trim() || username.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const now = Date.now();

    const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
    if (existing) {
      return c.json({ message: "User already exists", code: 10013 }, 409);
    }

    const token = randomUUID();

    db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      username,
      body.avatar ?? null,
      body.bot !== false ? 1 : 0,
      body.bio ?? null,
      token,
      now,
      now,
    );

    // Auto-join the bot to the cove guild (like Discord auto-adding to server)
    db.prepare(
      "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
    ).run(GUILD_ID, id, null, '[]', now);

    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
    return c.json({ ...toUser(row), token }, 201);
  });

  /** POST /api/v10/users/:id/token — regenerate bot token. */
  app.post("/api/v10/users/:id/token", (c) => {
    const id = c.req.param("id");
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    if (!row) {
      return c.json({ message: "Unknown User", code: 10013 }, 404);
    }

    const token = randomUUID();
    db.prepare("UPDATE users SET token = ?, updated_at = ? WHERE id = ?").run(token, Date.now(), id);
    return c.json({ token });
  });

  /** GET /api/v10/users/:id — get user details (Discord-compatible). */
  app.get("/api/v10/users/:id", (c, next) => {
    const id = c.req.param("id");
    if (id === "@me") return next(); // handled by app.ts
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    if (!row) {
      return c.json({ message: "Unknown User", code: 10013 }, 404);
    }
    return c.json(toUser(row));
  });

  /** PATCH /api/v10/users/:id — update user profile (Cove extension). */
  app.patch("/api/v10/users/:id", async (c) => {
    const id = c.req.param("id");
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    if (!row) {
      return c.json({ message: "Unknown User", code: 10013 }, 404);
    }

    const body = await c.req.json<{
      username?: string;
      avatar?: string | null;
      bio?: string | null;
    }>();

    const updates: string[] = [];
    const params: unknown[] = [];

    if (body.username !== undefined) {
      updates.push("username = ?");
      params.push(body.username);
    }
    if (body.avatar !== undefined) {
      updates.push("avatar = ?");
      params.push(body.avatar);
    }
    if (body.bio !== undefined) {
      updates.push("bio = ?");
      params.push(body.bio);
    }

    if (updates.length === 0) {
      return c.json(toUser(row));
    }

    updates.push("updated_at = ?");
    params.push(Date.now());
    params.push(id);

    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
    return c.json(toUser(updated));
  });

  /** DELETE /api/v10/users/:id — remove a user (Cove extension). */
  app.delete("/api/v10/users/:id", (c) => {
    const id = c.req.param("id");
    const row = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
    if (!row) {
      return c.json({ message: "Unknown User", code: 10013 }, 404);
    }

    db.prepare("DELETE FROM guild_members WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return c.body(null, 204);
  });

  // ─── Guild Members (Discord-compatible) ─────────────────────────────────

  /** GET /api/v10/guilds/:guildId/members — list guild members (Discord-compatible). */
  app.get("/api/v10/guilds/:guildId/members", (c) => {
    const guildId = c.req.param("guildId");
    if (guildId !== GUILD_ID) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    const rows = db.prepare(`
      SELECT u.*, gm.nick, gm.roles, gm.joined_at as gm_joined_at, gm.guild_id
      FROM users u
      JOIN guild_members gm ON gm.user_id = u.id
      WHERE gm.guild_id = ?
      ORDER BY u.username
    `).all(guildId) as Array<UserRow & { nick: string | null; roles: string; gm_joined_at: number; guild_id: string }>;

    return c.json(rows.map((r) => toGuildMember(r, {
      guild_id: r.guild_id,
      user_id: r.id,
      nick: r.nick,
      roles: r.roles,
      joined_at: r.gm_joined_at,
    })));
  });

  /** PUT /api/v10/guilds/:guildId/members/:userId — add user to guild (Discord-compatible). */
  app.put("/api/v10/guilds/:guildId/members/:userId", async (c) => {
    const guildId = c.req.param("guildId");
    const userId = c.req.param("userId");

    if (guildId !== GUILD_ID) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
    if (!user) {
      return c.json({ message: "Unknown User", code: 10013 }, 404);
    }

    const existing = db.prepare("SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
    if (existing) {
      // Already a member — return current state (Discord returns 204)
      const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
      return c.json(toGuildMember(userRow, existing as GuildMemberRow));
    }

    const body = await c.req.json<{ nick?: string; roles?: string[] }>().catch(() => ({} as { nick?: string; roles?: string[] }));
    const now = Date.now();

    db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)").run(
      guildId, userId, body.nick ?? null, JSON.stringify(body.roles ?? []), now,
    );

    const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
    const memberRow = db.prepare("SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId) as GuildMemberRow;
    return c.json(toGuildMember(userRow, memberRow), 201);
  });

  /** DELETE /api/v10/guilds/:guildId/members/:userId — remove user from guild (Discord-compatible). */
  app.delete("/api/v10/guilds/:guildId/members/:userId", (c) => {
    const guildId = c.req.param("guildId");
    const userId = c.req.param("userId");

    if (guildId !== GUILD_ID) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    const existing = db.prepare("SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
    if (!existing) {
      return c.json({ message: "Member not found" }, 404);
    }

    db.prepare("DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
    return c.body(null, 204);
  });

  return app;
}
