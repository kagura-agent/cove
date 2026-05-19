import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { Scene, Message } from "@cove/shared";

export function scenesRoutes(db: Database.Database): Hono {
  const app = new Hono();

  /** GET /api/scenes — list all scenes */
  app.get("/api/scenes", (c) => {
    const rows = db.prepare("SELECT * FROM scenes ORDER BY name").all() as Array<{
      id: string; name: string; icon: string; type: string;
      channel_id: string; description: string; position_x: number; position_y: number;
    }>;

    const scenes: Scene[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      type: r.type as Scene["type"],
      channelId: r.channel_id,
      description: r.description,
      position: { x: r.position_x, y: r.position_y },
    }));

    return c.json(scenes);
  });

  /** GET /api/scenes/:id — scene detail + recent messages */
  app.get("/api/scenes/:id", (c) => {
    const id = c.req.param("id");

    const row = db.prepare("SELECT * FROM scenes WHERE id = ?").get(id) as {
      id: string; name: string; icon: string; type: string;
      channel_id: string; description: string; position_x: number; position_y: number;
    } | undefined;

    if (!row) {
      return c.json({ error: "Scene not found" }, 404);
    }

    const scene: Scene = {
      id: row.id,
      name: row.name,
      icon: row.icon,
      type: row.type as Scene["type"],
      channelId: row.channel_id,
      description: row.description,
      position: { x: row.position_x, y: row.position_y },
    };

    const messageRows = db
      .prepare("SELECT * FROM messages WHERE scene_id = ? ORDER BY timestamp DESC LIMIT 50")
      .all(id) as Array<{
        id: string; scene_id: string; sender: string; content: string;
        timestamp: number; metadata: string | null;
      }>;

    const messages: Message[] = messageRows.map((m) => ({
      id: m.id,
      sceneId: m.scene_id,
      sender: m.sender,
      content: m.content,
      timestamp: m.timestamp,
      metadata: m.metadata ? JSON.parse(m.metadata) : undefined,
    }));

    return c.json({ scene, messages });
  });

  return app;
}
