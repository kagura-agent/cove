import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { DiscordMessage, DiscordUser } from "@cove/shared";

export type BroadcastFn = (event: unknown) => void;

/** Extract author info from Authorization header, resolving token against DB. */
function extractAuthor(db: Database.Database, authHeader: string | undefined): DiscordUser {
  if (authHeader?.startsWith("Bot ")) {
    const token = authHeader.slice(4).trim();
    if (token) {
      const row = db.prepare("SELECT id, username FROM users WHERE token = ?").get(token) as { id: string; username: string } | undefined;
      if (row) {
        return { id: row.id, username: row.username, bot: true };
      }
    }
  }
  return { id: "anonymous", username: "anonymous", bot: false };
}

/** DB row shape for messages. */
interface MessageRow {
  id: string;
  scene_id: string;
  sender: string;
  content: string;
  timestamp: number;
  metadata: string | null;
  edited_timestamp: number | null;
}

/** Convert a DB message row into a Discord message object. */
function toDiscordMessage(row: MessageRow): DiscordMessage {
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
    edited_timestamp: row.edited_timestamp
      ? new Date(row.edited_timestamp).toISOString()
      : null,
    type: 0,
  };
}

export function messagesRoutes(db: Database.Database, broadcast?: BroadcastFn): Hono {
  const app = new Hono();

  /** GET /api/v10/channels/:id/messages — list messages with optional pagination. */
  app.get("/api/v10/channels/:id/messages", (c) => {
    const channelId = c.req.param("id");

    // Verify channel/scene exists
    const scene = db.prepare("SELECT id FROM scenes WHERE id = ?").get(channelId);
    if (!scene) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 100);
    const before = c.req.query("before");
    const after = c.req.query("after");
    const around = c.req.query("around");

    let rows: MessageRow[];

    if (before) {
      const ref = db
        .prepare("SELECT timestamp FROM messages WHERE id = ?")
        .get(before) as { timestamp: number } | undefined;
      if (!ref) {
        return c.json([]);
      }
      rows = db
        .prepare(
          "SELECT * FROM messages WHERE scene_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?"
        )
        .all(channelId, ref.timestamp, limit) as MessageRow[];
    } else if (after) {
      const ref = db
        .prepare("SELECT timestamp FROM messages WHERE id = ?")
        .get(after) as { timestamp: number } | undefined;
      if (!ref) {
        return c.json([]);
      }
      rows = db
        .prepare(
          "SELECT * FROM messages WHERE scene_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?"
        )
        .all(channelId, ref.timestamp, limit) as MessageRow[];
    } else if (around) {
      const ref = db
        .prepare("SELECT timestamp FROM messages WHERE id = ?")
        .get(around) as { timestamp: number } | undefined;
      if (!ref) {
        return c.json([]);
      }
      const half = Math.floor(limit / 2);
      const beforeRows = db
        .prepare(
          "SELECT * FROM messages WHERE scene_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?"
        )
        .all(channelId, ref.timestamp, half) as MessageRow[];
      const centerRow = db
        .prepare(
          "SELECT * FROM messages WHERE scene_id = ? AND id = ?"
        )
        .get(channelId, around) as MessageRow | undefined;
      const afterRows = db
        .prepare(
          "SELECT * FROM messages WHERE scene_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?"
        )
        .all(channelId, ref.timestamp, half) as MessageRow[];
      const combined = [...beforeRows.reverse(), ...(centerRow ? [centerRow] : []), ...afterRows];
      // Return in DESC order like Discord
      rows = combined.reverse();
    } else {
      rows = db
        .prepare("SELECT * FROM messages WHERE scene_id = ? ORDER BY timestamp DESC LIMIT ?")
        .all(channelId, limit) as MessageRow[];
    }

    const messages: DiscordMessage[] = rows.map(toDiscordMessage);
    return c.json(messages);
  });

  /** GET /api/v10/channels/:id/messages/:msgId — get a single message. */
  app.get("/api/v10/channels/:id/messages/:msgId", (c) => {
    const channelId = c.req.param("id");
    const msgId = c.req.param("msgId");

    const row = db
      .prepare("SELECT * FROM messages WHERE id = ? AND scene_id = ?")
      .get(msgId, channelId) as MessageRow | undefined;

    if (!row) {
      return c.json({ message: "Unknown Message", code: 10008 }, 404);
    }

    return c.json(toDiscordMessage(row));
  });

  /** POST /api/v10/channels/:id/messages — send a message in Discord format. */
  app.post("/api/v10/channels/:id/messages", async (c) => {
    const channelId = c.req.param("id");

    // Verify channel/scene exists
    const scene = db.prepare("SELECT id FROM scenes WHERE id = ?").get(channelId);
    if (!scene) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    const body = await c.req.json<{ content: string; userId?: string; username?: string }>();
    // Prefer body userId/username (browser client), fall back to Authorization header (game server)
    const author = body.userId
      ? { id: body.userId, username: body.username || body.userId, bot: false }
      : extractAuthor(db, c.req.header("Authorization"));
    const now = Date.now();
    const id = randomUUID();

    db.prepare(
      "INSERT INTO messages (id, scene_id, sender, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, channelId, author.id, body.content, now, null, null);

    const message: DiscordMessage = {
      id,
      channel_id: channelId,
      content: body.content,
      author,
      timestamp: new Date(now).toISOString(),
      edited_timestamp: null,
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

  /** PATCH /api/v10/channels/:id/messages/:msgId — edit a message. */
  app.patch("/api/v10/channels/:id/messages/:msgId", async (c) => {
    const channelId = c.req.param("id");
    const msgId = c.req.param("msgId");
    const body = await c.req.json<{ content: string }>();
    const editedTimestamp = Date.now();

    const result = db
      .prepare(
        "UPDATE messages SET content = ?, edited_timestamp = ? WHERE id = ? AND scene_id = ?"
      )
      .run(body.content, editedTimestamp, msgId, channelId);

    if (result.changes === 0) {
      return c.json({ message: "Unknown Message", code: 10008 }, 404);
    }

    const row = db
      .prepare("SELECT * FROM messages WHERE id = ? AND scene_id = ?")
      .get(msgId, channelId) as MessageRow;

    const updated = toDiscordMessage(row);

    broadcast?.({
      op: 0,
      s: null,
      t: "MESSAGE_UPDATE",
      d: updated,
    });

    return c.json(updated);
  });

  /** DELETE /api/v10/channels/:id/messages/:msgId — delete a single message. */
  app.delete("/api/v10/channels/:id/messages/:msgId", (c) => {
    const channelId = c.req.param("id");
    const msgId = c.req.param("msgId");

    const result = db
      .prepare("DELETE FROM messages WHERE id = ? AND scene_id = ?")
      .run(msgId, channelId);

    if (result.changes === 0) {
      return c.json({ message: "Unknown Message", code: 10008 }, 404);
    }

    broadcast?.({
      op: 0,
      s: null,
      t: "MESSAGE_DELETE",
      d: { id: msgId, channel_id: channelId },
    });

    return c.body(null, 204);
  });

  /** DELETE /api/v10/channels/:id/messages — clear all messages in a channel. */
  app.delete("/api/v10/channels/:id/messages", (c) => {
    const channelId = c.req.param("id");
    const result = db.prepare("DELETE FROM messages WHERE scene_id = ?").run(channelId);
    return c.json({ deleted: result.changes });
  });

  /** DELETE /api/v10/messages — clear ALL messages across all channels. */
  app.delete("/api/v10/messages", (c) => {
    const result = db.prepare("DELETE FROM messages").run();
    return c.json({ deleted: result.changes });
  });

  /** POST /api/v10/channels/:id/typing — typing indicator. */
  app.post("/api/v10/channels/:id/typing", (c) => {
    const channelId = c.req.param("id");
    const author = extractAuthor(db, c.req.header("Authorization"));

    broadcast?.({
      op: 0,
      s: null,
      t: "TYPING_START",
      d: {
        channel_id: channelId,
        user_id: author.id,
        timestamp: Date.now(),
      },
    });

    return c.body(null, 204);
  });

  return app;
}
