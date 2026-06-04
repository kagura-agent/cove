import type Database from "better-sqlite3";
import { type DiscordGuild } from "@cove/shared";

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
  private cachedDefaultId: string | null = null;

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
    if (this.cachedDefaultId) return this.cachedDefaultId;
    const row = this.db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
    if (!row) {
      throw new Error("No guilds found in database. Run migrations first.");
    }
    this.cachedDefaultId = row.id;
    return row.id;
  }
}
