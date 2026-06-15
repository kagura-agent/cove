import type Database from "better-sqlite3";
import { generateSnowflake, type Channel } from "@cove/shared";
import type { PermissionsRepo } from "./permissions.js";

interface ChannelRow {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  topic: string | null;
  position: number;
  last_message_id: string | null;
  parent_id: string | null;
  message_id: string | null;
  thread_metadata: string | null;
  message_count: number;
  member_count: number;
  owner_id: string | null;
  total_message_sent: number;
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
    permission_overwrites: [],
    nsfw: false,
    rate_limit_per_user: 0,
    parent_id: row.parent_id ?? undefined,
    message_id: row.message_id ?? undefined,
    thread_metadata: row.thread_metadata ? JSON.parse(row.thread_metadata) : undefined,
    message_count: row.message_count ?? undefined,
    member_count: row.member_count ?? undefined,
    owner_id: row.owner_id ?? undefined,
    total_message_sent: row.total_message_sent ?? undefined,
  };
}

export class ChannelsRepo {
  private permissionsRepo: PermissionsRepo | null = null;

  constructor(private db: Database.Database) {}

  setPermissionsRepo(repo: PermissionsRepo): void {
    this.permissionsRepo = repo;
  }

  private enrichOverwrites(channel: Channel): Channel {
    if (!this.permissionsRepo) return channel;
    return { ...channel, permission_overwrites: this.permissionsRepo.listByChannel(channel.id) };
  }

  list(guildId: string): Channel[] {
    const rows = this.db.prepare("SELECT * FROM channels WHERE guild_id = ? ORDER BY position ASC").all(guildId) as ChannelRow[];
    return rows.map((r) => this.enrichOverwrites(toChannel(r)));
  }

  getById(id: string): Channel | null {
    const row = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRow | undefined;
    return row ? this.enrichOverwrites(toChannel(row)) : null;
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
