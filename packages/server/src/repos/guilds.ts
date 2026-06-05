import type Database from "better-sqlite3";
import { type Guild } from "@cove/shared";

interface GuildRow {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string | null;
  created_at: number;
  updated_at: number;
}

function toGuild(row: GuildRow): Guild {
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

  getById(id: string): Guild | null {
    const row = this.db.prepare("SELECT * FROM guilds WHERE id = ?").get(id) as GuildRow | undefined;
    return row ? toGuild(row) : null;
  }

  listForUser(userId: string): Guild[] {
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

  /** Resolve guild ID — accepts snowflake ID or "cove" alias for default guild */
  resolveId(idOrAlias: string): string | null {
    if (idOrAlias === "cove") return this.getDefaultId();
    return this.exists(idOrAlias) ? idOrAlias : null;
  }

  /**
   * TEMPORARY: Returns the first guild's ID as a stand-in for invite-based guild joining.
   * Discord doesn't have a "default guild" — users join via invite links or create their own.
   * Remove after #171 (invite system) + #111 (DMs) are implemented.
   * At that point, registration should NOT auto-join any guild.
   */
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
