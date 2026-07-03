import { generateSnowflake, DEFAULT_EVERYONE_PERMISSIONS } from "@cove/shared";
import type Database from "better-sqlite3";

/**
 * Create a personal guild for a user: guild + @everyone role + #general channel + membership.
 * Runs inside the caller's transaction if one is active, or can be wrapped in one.
 * Does NOT start its own transaction — callers are responsible for transaction boundaries.
 */
export function createPersonalGuild(db: Database.Database, userId: string, username: string): void {
  const guildId = generateSnowflake();
  const channelId = generateSnowflake();
  const now = Date.now();

  // Create guild
  db.prepare(
    "INSERT INTO guilds (id, name, icon, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(guildId, `${username}'s Server`, null, userId, now, now);

  // Create @everyone role
  db.prepare(
    `INSERT INTO roles (id, guild_id, name, color, hoist, position, permissions, managed, mentionable, flags, bot_id)
     VALUES (?, ?, ?, 0, 0, 0, ?, 0, 0, 0, NULL)`
  ).run(guildId, guildId, "@everyone", DEFAULT_EVERYONE_PERMISSIONS.toString());

  // Create #general channel
  db.prepare(
    "INSERT INTO channels (id, guild_id, name, topic, position, type) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(channelId, guildId, "general", null, 0, 0);

  // Add user as member
  db.prepare(
    "INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
  ).run(guildId, userId, null, "[]", now);
}

/**
 * Ensure a user has at least one personal guild (idempotent).
 * If the user already owns a guild, does nothing.
 * Wraps createPersonalGuild in a transaction.
 */
export function ensurePersonalGuild(db: Database.Database, userId: string, username: string): void {
  const existing = db.prepare(
    "SELECT COUNT(*) as count FROM guild_members WHERE user_id = ? AND guild_id IN (SELECT id FROM guilds WHERE owner_id = ?)"
  ).get(userId, userId) as { count: number };
  if (existing.count > 0) return;

  db.transaction(() => {
    createPersonalGuild(db, userId, username);
  })();
}
