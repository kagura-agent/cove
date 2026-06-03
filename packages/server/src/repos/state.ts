import type Database from "better-sqlite3";
import type { SceneState } from "@cove/shared";

export class StateRepo {
  constructor(private db: Database.Database) {}

  list(channelId: string): SceneState[] {
    const rows = this.db.prepare("SELECT * FROM scene_state WHERE scene_id = ?")
      .all(channelId) as Array<{ scene_id: string; key: string; value: string; updated_at: number }>;

    return rows.map((r) => ({
      sceneId: r.scene_id,
      key: r.key,
      value: r.value,
      updatedAt: r.updated_at,
    }));
  }

  upsert(channelId: string, key: string, value: string): SceneState {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO scene_state (scene_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scene_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(channelId, key, value, now);

    return { sceneId: channelId, key, value, updatedAt: now };
  }

  delete(channelId: string, key: string): boolean {
    const existing = this.db.prepare("SELECT * FROM scene_state WHERE scene_id = ? AND key = ?").get(channelId, key);
    if (!existing) return false;
    this.db.prepare("DELETE FROM scene_state WHERE scene_id = ? AND key = ?").run(channelId, key);
    return true;
  }
}
