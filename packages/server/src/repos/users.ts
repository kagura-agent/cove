import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CoveAgent } from "@cove/shared";

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

function toUser(row: UserRow): CoveAgent {
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    bot: row.bot === 1,
    bio: row.bio,
  };
}

export class UsersRepo {
  constructor(private db: Database.Database) {}

  getById(id: string): CoveAgent | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  create(opts: { id?: string; username: string; avatar?: string; bot?: boolean; bio?: string }, guildId: string): CoveAgent & { token: string } {
    const username = opts.username;
    const id = opts.id?.trim() || username.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const now = Date.now();
    const token = randomUUID();

    this.db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, username, opts.avatar ?? null, opts.bot !== false ? 1 : 0, opts.bio ?? null, token, now, now);

    // Auto-join the bot to the cove guild
    this.db.prepare(
      "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
    ).run(guildId, id, null, '[]', now);

    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
    return { ...toUser(row), token };
  }

  update(id: string, fields: { username?: string; avatar?: string | null; bio?: string | null }): CoveAgent | null {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (fields.username !== undefined) { updates.push("username = ?"); params.push(fields.username); }
    if (fields.avatar !== undefined) { updates.push("avatar = ?"); params.push(fields.avatar); }
    if (fields.bio !== undefined) { updates.push("bio = ?"); params.push(fields.bio); }

    if (updates.length === 0) return this.getById(id);

    updates.push("updated_at = ?");
    params.push(Date.now());
    params.push(id);

    this.db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const row = this.db.prepare("SELECT id FROM users WHERE id = ?").get(id);
    if (!row) return false;
    this.db.prepare("DELETE FROM guild_members WHERE user_id = ?").run(id);
    this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return true;
  }

  regenerateToken(id: string): string | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    if (!row) return null;
    const token = randomUUID();
    this.db.prepare("UPDATE users SET token = ?, updated_at = ? WHERE id = ?").run(token, Date.now(), id);
    return token;
  }

  exists(id: string): boolean {
    return !!this.db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  }

  findByToken(token: string): CoveAgent & { bot: boolean } | null {
    const row = this.db.prepare("SELECT id, username, avatar, bot, bio FROM users WHERE token = ?").get(token) as UserRow | undefined;
    return row ? { id: row.id, username: row.username, avatar: row.avatar, bot: row.bot === 1, bio: row.bio } : null;
  }
}
