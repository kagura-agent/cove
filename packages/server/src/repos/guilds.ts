import type Database from "better-sqlite3";
import { DEFAULT_GUILD_ID, type DiscordGuild } from "@cove/shared";

interface GuildRow {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string | null;
  created_at: number;
  updated_at: number;
}

function toGuild(row: GuildRow): DiscordGuild {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    owner_id: row.owner_id,
  };
}

export class GuildsRepo {
  constructor(private db: Database.Database) {}

  getById(id: string): DiscordGuild | null {
    const row = this.db.prepare("SELECT * FROM guilds WHERE id = ?").get(id) as GuildRow | undefined;
    return row ? toGuild(row) : null;
  }

  listForUser(userId: string): DiscordGuild[] {
    const rows = this.db.prepare(`
      SELECT g.* FROM guilds g
      JOIN guild_members gm ON gm.guild_id = g.id
      WHERE gm.user_id = ?
      ORDER BY g.name
    `).all(userId) as GuildRow[];
    return rows.map(toGuild);
  }

  exists(id: string): boolean {
    return !!this.db.prepare("SELECT id FROM guilds WHERE id = ?").get(id);
  }

  getDefaultId(): string {
    const row = this.db.prepare("SELECT id FROM guilds WHERE id = ?").get(DEFAULT_GUILD_ID) as { id: string } | undefined;
    return row?.id ?? DEFAULT_GUILD_ID;
  }
}
