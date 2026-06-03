import type Database from "better-sqlite3";
import type { DiscordChannel } from "@cove/shared";

const GUILD_ID = "cove";

interface SceneRow {
  id: string;
  name: string;
  icon: string;
  type: string;
  channel_id: string;
  description: string;
  position_x: number;
  position_y: number;
}

function toDiscordChannel(row: SceneRow, position: number): DiscordChannel {
  return {
    id: row.id,
    name: row.name,
    type: 0,
    guild_id: GUILD_ID,
    topic: row.description ?? "",
    position,
    icon: row.icon,
    scene_type: row.type,
    cove_position: { x: row.position_x, y: row.position_y },
  };
}

export class ChannelsRepo {
  constructor(private db: Database.Database) {}

  list(guildId: string): DiscordChannel[] {
    const rows = this.db.prepare("SELECT * FROM scenes ORDER BY name").all() as SceneRow[];
    return rows.map((r, i) => toDiscordChannel(r, i));
  }

  getById(id: string): DiscordChannel | null {
    const row = this.db.prepare(
      "SELECT s.*, (SELECT COUNT(*) FROM scenes s2 WHERE s2.name < s.name) AS position FROM scenes s WHERE s.id = ?"
    ).get(id) as (SceneRow & { position: number }) | undefined;
    return row ? toDiscordChannel(row, row.position) : null;
  }

  create(name: string, icon?: string, topic?: string): DiscordChannel {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    this.db.prepare(
      "INSERT INTO scenes (id, name, icon, type, channel_id, description, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, name, icon ?? "🏝️", "open", id, topic ?? "", 0, 0);

    const count = (this.db.prepare("SELECT COUNT(*) as c FROM scenes").get() as any).c;
    const row = this.db.prepare("SELECT * FROM scenes WHERE id = ?").get(id) as SceneRow;
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
      this.db.prepare(`UPDATE scenes SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    }

    return this.getById(id);
  }

  delete(id: string): boolean {
    const row = this.db.prepare("SELECT id FROM scenes WHERE id = ?").get(id);
    if (!row) return false;

    this.db.transaction(() => {
      this.db.prepare("DELETE FROM messages WHERE scene_id = ?").run(id);
      this.db.prepare("DELETE FROM scene_state WHERE scene_id = ?").run(id);
      this.db.prepare("DELETE FROM scenes WHERE id = ?").run(id);
    })();
    return true;
  }

  exists(id: string): boolean {
    return !!this.db.prepare("SELECT id FROM scenes WHERE id = ?").get(id);
  }
}
