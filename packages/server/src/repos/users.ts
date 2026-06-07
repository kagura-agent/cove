import type Database from "better-sqlite3";
import crypto from "node:crypto";
import type { CoveAgent } from "@cove/shared";

const parsedTTL = parseInt(process.env["SESSION_TTL_MS"] ?? "604800000", 10); // 7 days
if (!Number.isFinite(parsedTTL) || parsedTTL <= 0) {
  throw new Error(`Invalid SESSION_TTL_MS: ${process.env["SESSION_TTL_MS"]}`);
}
export const SESSION_TTL_MS = parsedTTL;

interface UserRow {
  id: string;
  username: string;
  avatar: string | null;
  bot: number;
  bio: string | null;
  token: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
}

function toUser(row: UserRow): CoveAgent {
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    bot: row.bot === 1,
    bio: row.bio,
    discriminator: "0",
    global_name: null,
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
    const token = crypto.randomUUID();
    const isBot = opts.bot !== false;
    const expiresAt = isBot ? null : now + SESSION_TTL_MS;

    this.db.prepare(
      "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, username, opts.avatar ?? null, isBot ? 1 : 0, opts.bio ?? null, token, now, now, expiresAt);

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
    const result = this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return result.changes > 0;
  }

  regenerateToken(id: string): string | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    if (!row) return null;
    const token = crypto.randomUUID();
    this.db.prepare("UPDATE users SET token = ?, updated_at = ? WHERE id = ?").run(token, Date.now(), id);
    return token;
  }

  exists(id: string): boolean {
    return !!this.db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  }

  findByToken(token: string): (CoveAgent & { bot: boolean; expires_at: number | null }) | null {
    const row = this.db.prepare("SELECT id, username, avatar, bot, bio, expires_at FROM users WHERE token = ?").get(token) as (UserRow & { expires_at: number | null }) | undefined;
    if (!row) return null;

    // Check expiry: non-null expires_at that's in the past means expired
    if (row.expires_at !== null && row.expires_at < Date.now()) {
      this.db.prepare("UPDATE users SET token = NULL, expires_at = NULL WHERE token = ?").run(token);
      return null;
    }

    return { id: row.id, username: row.username, avatar: row.avatar, bot: row.bot === 1, bio: row.bio, discriminator: "0" as const, global_name: null, expires_at: row.expires_at };
  }

  refreshTTL(id: string): void {
    this.db.prepare(
      "UPDATE users SET expires_at = ?, updated_at = ? WHERE id = ? AND bot = 0"
    ).run(Date.now() + SESSION_TTL_MS, Date.now(), id);
  }

  cleanupExpired(): number {
    const result = this.db.prepare(
      "UPDATE users SET token = NULL, expires_at = NULL WHERE expires_at IS NOT NULL AND expires_at < ?"
    ).run(Date.now());
    return result.changes;
  }
}
