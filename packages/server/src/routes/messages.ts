import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Message, SceneState } from "@cove/shared";

export type BroadcastFn = (sceneId: string, event: unknown) => void;

export function messagesRoutes(db: Database.Database, broadcast?: BroadcastFn): Hono {
  const app = new Hono();

  /** POST /api/scenes/:id/messages — send a message to a scene */
  app.post("/api/scenes/:id/messages", async (c) => {
    const sceneId = c.req.param("id");

    // Verify scene exists
    const scene = db.prepare("SELECT id FROM scenes WHERE id = ?").get(sceneId);
    if (!scene) {
      return c.json({ error: "Scene not found" }, 404);
    }

    const body = await c.req.json<{ sender: string; content: string; metadata?: Record<string, unknown> }>();

    const message: Message = {
      id: randomUUID(),
      sceneId,
      sender: body.sender,
      content: body.content,
      timestamp: Date.now(),
      metadata: body.metadata,
    };

    db.prepare(
      "INSERT INTO messages (id, scene_id, sender, content, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      message.id,
      message.sceneId,
      message.sender,
      message.content,
      message.timestamp,
      message.metadata ? JSON.stringify(message.metadata) : null
    );

    // Broadcast to WebSocket subscribers
    broadcast?.(sceneId, { type: "message", payload: message });

    return c.json(message, 201);
  });

  /** GET /api/scenes/:id/state — get all state entries for a scene */
  app.get("/api/scenes/:id/state", (c) => {
    const sceneId = c.req.param("id");

    const rows = db
      .prepare("SELECT * FROM scene_state WHERE scene_id = ?")
      .all(sceneId) as Array<{
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

  /** PUT /api/scenes/:id/state — upsert a state entry */
  app.put("/api/scenes/:id/state", async (c) => {
    const sceneId = c.req.param("id");
    const body = await c.req.json<{ key: string; value: string }>();
    const now = Date.now();

    db.prepare(`
      INSERT INTO scene_state (scene_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scene_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(sceneId, body.key, body.value, now);

    const entry: SceneState = {
      sceneId,
      key: body.key,
      value: body.value,
      updatedAt: now,
    };

    broadcast?.(sceneId, { type: "state_update", payload: entry });

    return c.json(entry);
  });

  return app;
}
