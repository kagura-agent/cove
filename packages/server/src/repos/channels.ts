import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { DiscordChannel } from "@cove/shared";

interface ChannelRow {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  topic: string | null;
  position: number;
}

function toDiscordChannel(row: ChannelRow): DiscordChannel {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    guild_id: row.guild_id,
    topic: row.topic,
    position: row.position,
  };
}

export class ChannelsRepo {
  constructor(private db: Database.Database) {}

  list(guildId: string): DiscordChannel[] {
    const rows = this.db.prepare("SELECT * FROM channels WHERE guild_id = ? ORDER BY position ASC").all(guildId) as ChannelRow[];
    return rows.map(toDiscordChannel);
  }

  getById(id: string): DiscordChannel | null {
    const row = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRow | undefined;
    return row ? toDiscordChannel(row) : null;
  }

  create(guildId: string, name: string, topic?: string, type?: number): DiscordChannel {
    const id = randomUUID();
    const maxPos = (this.db.prepare("SELECT MAX(position) as m FROM channels WHERE guild_id = ?").get(guildId) as { m: number | null }).m;
    const position = (maxPos ?? -1) + 1;

    this.db.prepare(
      "INSERT INTO channels (id, guild_id, name, type, topic, position) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, guildId, name, type ?? 0, topic ?? null, position);

    const row = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRow;
    return toDiscordChannel(row);
  }

  update(id: string, fields: { name?: string; topic?: string; position?: number; type?: number }): DiscordChannel | null {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (fields.name !== undefined) { updates.push("name = ?"); params.push(fields.name); }
    if (fields.topic !== undefined) { updates.push("topic = ?"); params.push(fields.topic); }
    if (fields.position !== undefined) { updates.push("position = ?"); params.push(fields.position); }
    if (fields.type !== undefined) { updates.push("type = ?"); params.push(fields.type); }

    if (updates.length > 0) {
      params.push(id);
      this.db.prepare(`UPDATE channels SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    }

    return this.getById(id);
  }

  delete(id: string): boolean {
    const row = this.db.prepare("SELECT id FROM channels WHERE id = ?").get(id);
    if (!row) return false;

    this.db.transaction(() => {
      this.db.prepare("DELETE FROM messages WHERE channel_id = ?").run(id);
      this.db.prepare("DELETE FROM channels WHERE id = ?").run(id);
    })();
    return true;
  }

  exists(id: string): boolean {
    return !!this.db.prepare("SELECT id FROM channels WHERE id = ?").get(id);
  }
}
