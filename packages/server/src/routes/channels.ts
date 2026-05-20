import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { DiscordChannel, SceneState } from "@cove/shared";

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

/** Convert a DB scene row + index into a Discord channel object. */
function toDiscordChannel(row: SceneRow, position: number): DiscordChannel {
  return {
    id: row.id,
    name: row.name,
    type: 0, // GUILD_TEXT
    guild_id: GUILD_ID,
    topic: row.description ?? "",
    position,
    icon: row.icon,
    scene_type: row.type,
    cove_position: { x: row.position_x, y: row.position_y },
  };
}

export function channelRoutes(db: Database.Database): Hono {
  const app = new Hono();

  /** GET /api/v10/guilds/:guildId/channels — list all scenes as Discord channels. */
  app.get("/api/v10/guilds/:guildId/channels", (c) => {
    const guildId = c.req.param("guildId");
    if (guildId !== GUILD_ID) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    const rows = db.prepare("SELECT * FROM scenes ORDER BY name").all() as SceneRow[];
    const channels: DiscordChannel[] = rows.map((r, i) => toDiscordChannel(r, i));
    return c.json(channels);
  });

  /** GET /api/v10/channels/:id — single channel detail. */
  app.get("/api/v10/channels/:id", (c) => {
    const id = c.req.param("id");
    const row = db.prepare("SELECT * FROM scenes WHERE id = ?").get(id) as SceneRow | undefined;
    if (!row) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    // Find position by sorting all scenes
    const allIds = (db.prepare("SELECT id FROM scenes ORDER BY name").all() as Array<{ id: string }>)
      .map((r) => r.id);
    const position = allIds.indexOf(id);

    return c.json(toDiscordChannel(row, position));
  });

  /** GET /api/v10/channels/:id/state — get all state entries for a channel (Cove extension). */
  app.get("/api/v10/channels/:id/state", (c) => {
    const channelId = c.req.param("id");
    const rows = db
      .prepare("SELECT * FROM scene_state WHERE scene_id = ?")
      .all(channelId) as Array<{
        scene_id: string; key: string; value: string; updated_at: number;
      }>;

    const state: SceneState[] = rows.map((r) => ({
      sceneId: r.scene_id,
      key: r.key,
      value: r.value,
      updatedAt: r.updated_at,
    }));

    return c.json(state);
  });

  /** PUT /api/v10/channels/:id/state — upsert a state entry (Cove extension). */
  app.put("/api/v10/channels/:id/state", async (c) => {
    const channelId = c.req.param("id");
    const body = await c.req.json<{ key: string; value: string }>();
    const now = Date.now();

    db.prepare(`
      INSERT INTO scene_state (scene_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scene_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(channelId, body.key, body.value, now);

    const entry: SceneState = {
      sceneId: channelId,
      key: body.key,
      value: body.value,
      updatedAt: now,
    };

    return c.json(entry);
  });

  /** POST /api/v10/guilds/:guildId/channels — create a new scene/channel. */
  app.post("/api/v10/guilds/:guildId/channels", async (c) => {
    const guildId = c.req.param("guildId");
    if (guildId !== GUILD_ID) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    const body = await c.req.json<{ name: string; icon?: string; topic?: string }>();
    const name = body.name?.trim();
    if (!name) {
      return c.json({ message: "Name is required" }, 400);
    }

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    // Check if already exists
    const existing = db.prepare("SELECT id FROM scenes WHERE id = ?").get(id);
    if (existing) {
      return c.json({ message: "Channel already exists", code: 10013 }, 409);
    }

    db.prepare(
      "INSERT INTO scenes (id, name, icon, type, channel_id, description, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, name, body.icon ?? "🏝️", "outdoor", id, body.topic ?? "", 0, 0);

    const count = (db.prepare("SELECT COUNT(*) as c FROM scenes").get() as any).c;
    const row = db.prepare("SELECT * FROM scenes WHERE id = ?").get(id) as SceneRow;
    return c.json(toDiscordChannel(row, count - 1), 201);
  });

  /** DELETE /api/v10/channels/:id — delete a scene/channel and its messages. */
  app.delete("/api/v10/channels/:id", (c) => {
    const id = c.req.param("id");
    const row = db.prepare("SELECT id FROM scenes WHERE id = ?").get(id);
    if (!row) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    db.prepare("DELETE FROM messages WHERE scene_id = ?").run(id);
    db.prepare("DELETE FROM scene_state WHERE scene_id = ?").run(id);
    db.prepare("DELETE FROM scenes WHERE id = ?").run(id);
    return c.json({ deleted: true });
  });

  return app;
}
