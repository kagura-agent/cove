import type Database from "better-sqlite3";
import type { CoveAgent, CoveGuildMember } from "@cove/shared";

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

export class MembersRepo {
  constructor(private db: Database.Database) {}

  list(guildId: string): CoveGuildMember[] {
    const rows = this.db.prepare(`
      SELECT u.*, gm.nick, gm.roles, gm.joined_at as gm_joined_at, gm.guild_id
      FROM users u
      JOIN guild_members gm ON gm.user_id = u.id
      WHERE gm.guild_id = ?
      ORDER BY u.username
    `).all(guildId) as Array<UserRow & { nick: string | null; roles: string; gm_joined_at: number; guild_id: string }>;

    return rows.map((r) => toGuildMember(r, {
      guild_id: r.guild_id,
      user_id: r.id,
      nick: r.nick,
      roles: r.roles,
      joined_at: r.gm_joined_at,
    }));
  }

  add(guildId: string, userId: string, nick?: string, roles?: string[]): CoveGuildMember {
    const now = Date.now();
    this.db.prepare("INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)").run(
      guildId, userId, nick ?? null, JSON.stringify(roles ?? []), now,
    );

    const userRow = this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
    const memberRow = this.db.prepare("SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId) as GuildMemberRow;
    return toGuildMember(userRow, memberRow);
  }

  get(guildId: string, userId: string): CoveGuildMember | null {
    const memberRow = this.db.prepare("SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId) as GuildMemberRow | undefined;
    if (!memberRow) return null;
    const userRow = this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
    return toGuildMember(userRow, memberRow);
  }

  remove(guildId: string, userId: string): boolean {
    const result = this.db.prepare("DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
    return result.changes > 0;
  }

  exists(guildId: string, userId: string): boolean {
    return !!this.db.prepare("SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  }
}
