import type Database from "better-sqlite3";
import { generateSnowflake, type Guild } from "@cove/shared";

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
    features: [],
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

  create(data: { id: string; name: string; icon?: string; owner_id: string }): Guild {
    const now = Date.now();
    this.db.prepare(
      "INSERT INTO guilds (id, name, icon, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(data.id, data.name, data.icon ?? null, data.owner_id, now, now);
    return { id: data.id, name: data.name, icon: data.icon ?? null, owner_id: data.owner_id, features: [] };
  }

  update(id: string, data: { name?: string; icon?: string }): Guild | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const params: unknown[] = [];
    if (data.name !== undefined) { updates.push("name = ?"); params.push(data.name); }
    if (data.icon !== undefined) { updates.push("icon = ?"); params.push(data.icon); }

    if (updates.length > 0) {
      updates.push("updated_at = ?");
      params.push(Date.now());
      params.push(id);
      this.db.prepare(`UPDATE guilds SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    }

    return this.getById(id)!;
  }

  delete(id: string): boolean {
    return this.db.transaction(() => {
      // Get channel IDs for this guild (needed for cascading)
      const channelIds = (this.db.prepare("SELECT id FROM channels WHERE guild_id = ?").all(id) as { id: string }[]).map(r => r.id);

      // Delete messages in those channels
      if (channelIds.length > 0) {
        const placeholders = channelIds.map(() => "?").join(",");
        this.db.prepare(`DELETE FROM messages WHERE channel_id IN (${placeholders})`).run(...channelIds);
        this.db.prepare(`DELETE FROM read_states WHERE channel_id IN (${placeholders})`).run(...channelIds);
        this.db.prepare(`DELETE FROM channel_permission_overwrites WHERE channel_id IN (${placeholders})`).run(...channelIds);
      }

      // Delete channels, members, roles, webhooks
      this.db.prepare("DELETE FROM channels WHERE guild_id = ?").run(id);
      this.db.prepare("DELETE FROM guild_members WHERE guild_id = ?").run(id);
      this.db.prepare("DELETE FROM roles WHERE guild_id = ?").run(id);
      this.db.prepare("DELETE FROM webhooks WHERE guild_id = ?").run(id);

      // Delete the guild itself
      const result = this.db.prepare("DELETE FROM guilds WHERE id = ?").run(id);
      return result.changes > 0;
    })();
  }

  countByOwner(userId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM guilds WHERE owner_id = ?").get(userId) as { count: number };
    return row.count;
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
