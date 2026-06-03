import type Database from "better-sqlite3";
import type { DiscordChannel } from "@cove/shared";

import { DEFAULT_GUILD_ID } from "./index.js";

interface ChannelRow {
  id: string;
  name: string;
  icon: string;
  type: string;
  channel_id: string;
  description: string;
  position_x: number;
  position_y: number;
}

function toDiscordChannel(row: ChannelRow, position: number): DiscordChannel {
  return {
    id: row.id,
    name: row.name,
    type: 0,
    guild_id: DEFAULT_GUILD_ID,
    topic: row.description ?? "",
    position,
    icon: row.icon,
    channel_type: row.type,
    cove_position: { x: row.position_x, y: row.position_y },
  };
}

export class ChannelsRepo {
  constructor(private db: Database.Database) {}

  // guildId accepted for API symmetry; unused until multi-guild support
  list(guildId: string): DiscordChannel[] {
    const rows = this.db.prepare("SELECT * FROM channels ORDER BY name").all() as ChannelRow[];
    return rows.map((r, i) => toDiscordChannel(r, i));
  }

  getById(id: string): DiscordChannel | null {
    const row = this.db.prepare(
      "SELECT s.*, (SELECT COUNT(*) FROM channels s2 WHERE s2.name < s.name) AS position FROM channels s WHERE s.id = ?"
    ).get(id) as (ChannelRow & { position: number }) | undefined;
    return row ? toDiscordChannel(row, row.position) : null;
  }

  create(name: string, icon?: string, topic?: string): DiscordChannel {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    this.db.prepare(
      "INSERT INTO channels (id, name, icon, type, channel_id, description, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, name, icon ?? "🏝️", "open", id, topic ?? "", 0, 0);

    const count = (this.db.prepare("SELECT COUNT(*) as c FROM channels").get() as any).c;
    const row = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRow;
    return toDiscordChannel(row, count - 1);
  }

  update(id: string, fields: { name?: string; topic?: string; icon?: string; cove_position?: { x: number; y: number } }): DiscordChannel | null {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (fields.name !== undefined) { updates.push("name = ?"); params.push(fields.name); }
    if (fields.topic !== undefined) { updates.push("description = ?"); params.push(fields.topic); }
    if (fields.icon !== undefined) { updates.push("icon = ?"); params.push(fields.icon); }
    if (fields.cove_position !== undefined) {
      updates.push("position_x = ?, position_y = ?");
      params.push(fields.cove_position.x, fields.cove_position.y);
    }

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
      this.db.prepare("DELETE FROM channel_state WHERE channel_id = ?").run(id);
      this.db.prepare("DELETE FROM channels WHERE id = ?").run(id);
    })();
    return true;
  }

  exists(id: string): boolean {
    return !!this.db.prepare("SELECT id FROM channels WHERE id = ?").get(id);
  }
}
