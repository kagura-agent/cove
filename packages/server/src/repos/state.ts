import type Database from "better-sqlite3";
import type { ChannelState } from "@cove/shared";

export class StateRepo {
  constructor(private db: Database.Database) {}

  list(channelId: string): ChannelState[] {
    const rows = this.db.prepare("SELECT * FROM channel_state WHERE channel_id = ?")
      .all(channelId) as Array<{ channel_id: string; key: string; value: string; updated_at: number }>;

    return rows.map((r) => ({
      channelId: r.channel_id,
      key: r.key,
      value: r.value,
      updatedAt: r.updated_at,
    }));
  }

  upsert(channelId: string, key: string, value: string): ChannelState {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO channel_state (channel_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(channelId, key, value, now);

    return { channelId, key, value, updatedAt: now };
  }

  delete(channelId: string, key: string): boolean {
    const existing = this.db.prepare("SELECT * FROM channel_state WHERE channel_id = ? AND key = ?").get(channelId, key);
    if (!existing) return false;
    this.db.prepare("DELETE FROM channel_state WHERE channel_id = ? AND key = ?").run(channelId, key);
    return true;
  }
}
