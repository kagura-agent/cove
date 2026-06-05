import type Database from "better-sqlite3";
import { generateSnowflake, type Channel } from "@cove/shared";

interface ChannelRow {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  topic: string | null;
  position: number;
  last_message_id: string | null;
}

function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    guild_id: row.guild_id,
    topic: row.topic,
    position: row.position,
    last_message_id: row.last_message_id,
  };
}

export class ChannelsRepo {
  constructor(private db: Database.Database) {}

  list(guildId: string): Channel[] {
    const rows = this.db.prepare("SELECT * FROM channels WHERE guild_id = ? ORDER BY position ASC").all(guildId) as ChannelRow[];
    return rows.map(toChannel);
  }

  getById(id: string): Channel | null {
    const row = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRow | undefined;
    return row ? toChannel(row) : null;
  }

  create(guildId: string, name: string, topic?: string, type?: number): Channel {
    const id = generateSnowflake();
    const maxPos = (this.db.prepare("SELECT MAX(position) as m FROM channels WHERE guild_id = ?").get(guildId) as { m: number | null }).m;
    const position = (maxPos ?? -1) + 1;

    this.db.prepare(
      "INSERT INTO channels (id, guild_id, name, type, topic, position) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, guildId, name, type ?? 0, topic ?? null, position);

    const row = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRow;
    return toChannel(row);
  }

  update(id: string, fields: { name?: string; topic?: string; position?: number; type?: number }): Channel | null {
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
    const result = this.db.prepare("DELETE FROM channels WHERE id = ?").run(id);
    return result.changes > 0;
  }

  exists(id: string): boolean {
    return !!this.db.prepare("SELECT id FROM channels WHERE id = ?").get(id);
  }

  updateLastMessageId(channelId: string, messageId: string): void {
    this.db.prepare("UPDATE channels SET last_message_id = ? WHERE id = ?").run(messageId, channelId);
  }

  recomputeLastMessageId(channelId: string): void {
    const row = this.db.prepare("SELECT id FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT 1").get(channelId) as { id: string } | undefined;
    this.db.prepare("UPDATE channels SET last_message_id = ? WHERE id = ?").run(row?.id ?? null, channelId);
  }
}
