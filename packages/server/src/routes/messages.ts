import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { DiscordMessage, DiscordUser } from "@cove/shared";

export type BroadcastFn = (event: unknown) => void;

/** Extract author info from Authorization header. */
function extractAuthor(authHeader: string | undefined): DiscordUser {
  if (authHeader?.startsWith("Bot ")) {
    const token = authHeader.slice(4).trim();
    return { id: token, username: token, bot: true };
  }
  return { id: "anonymous", username: "anonymous", bot: false };
}

/** Convert a DB message row into a Discord message object. */
function toDiscordMessage(row: {
  id: string;
  scene_id: string;
  sender: string;
  content: string;
  timestamp: number;
  metadata: string | null;
}): DiscordMessage {
  return {
    id: row.id,
    channel_id: row.scene_id,
    content: row.content,
    author: {
      id: row.sender,
      username: row.sender,
      bot: false,
    },
    timestamp: new Date(row.timestamp).toISOString(),
    type: 0,
  };
}

export function messagesRoutes(db: Database.Database, broadcast?: BroadcastFn): Hono {
  const app = new Hono();

  /** GET /api/v10/channels/:id/messages — list messages in Discord format. */
  app.get("/api/v10/channels/:id/messages", (c) => {
    const channelId = c.req.param("id");

    // Verify channel/scene exists
    const scene = db.prepare("SELECT id FROM scenes WHERE id = ?").get(channelId);
    if (!scene) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 100);

    const rows = db
      .prepare("SELECT * FROM messages WHERE scene_id = ? ORDER BY timestamp DESC LIMIT ?")
      .all(channelId, limit) as Array<{
        id: string; scene_id: string; sender: string; content: string;
        timestamp: number; metadata: string | null;
      }>;

    const messages: DiscordMessage[] = rows.map(toDiscordMessage);
    return c.json(messages);
  });

  /** POST /api/v10/channels/:id/messages — send a message in Discord format. */
  app.post("/api/v10/channels/:id/messages", async (c) => {
    const channelId = c.req.param("id");

    // Verify channel/scene exists
    const scene = db.prepare("SELECT id FROM scenes WHERE id = ?").get(channelId);
    if (!scene) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    const body = await c.req.json<{ content: string }>();
    const author = extractAuthor(c.req.header("Authorization"));
    const now = Date.now();
    const id = randomUUID();

    db.prepare(
      "INSERT INTO messages (id, scene_id, sender, content, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, channelId, author.id, body.content, now, null);

    const message: DiscordMessage = {
      id,
      channel_id: channelId,
      content: body.content,
      author,
      timestamp: new Date(now).toISOString(),
      type: 0,
    };

    // Broadcast MESSAGE_CREATE to Gateway clients
    broadcast?.({
      op: 0,
      s: null,
      t: "MESSAGE_CREATE",
      d: message,
    });

    return c.json(message, 201);
  });

  return app;
}
