import type Database from "better-sqlite3";
import { generateSnowflake, type Message, type User } from "@cove/shared";

interface MessageRow {
  id: string;
  channel_id: string;
  sender: string;
  sender_name: string | null;
  content: string;
  timestamp: number;
  metadata: string | null;
  edited_timestamp: number | null;
  sender_username: string | null;
  sender_bot: number | null;
}

const MSG_SELECT = "SELECT m.*, u.username AS sender_username, u.bot AS sender_bot FROM messages m LEFT JOIN users u ON u.id = m.sender";

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    channel_id: row.channel_id,
    content: row.content,
    author: {
      id: row.sender,
      username: row.sender_username ?? row.sender_name ?? row.sender,
      bot: row.sender_bot === 1,
    },
    timestamp: new Date(row.timestamp).toISOString(),
    edited_timestamp: row.edited_timestamp
      ? new Date(row.edited_timestamp).toISOString()
      : null,
    type: 0,
  };
}

export class MessagesRepo {
  constructor(private db: Database.Database) {}

  list(channelId: string, opts: { limit: number; before?: string; after?: string; around?: string }): Message[] {
    const { limit, before, after, around } = opts;
    let rows: MessageRow[];

    if (before) {
      rows = this.db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
        .all(channelId, before, limit) as MessageRow[];
    } else if (after) {
      rows = this.db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`)
        .all(channelId, after, limit) as MessageRow[];
    } else if (around) {
      const half = Math.floor(limit / 2);
      const beforeRows = this.db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
        .all(channelId, around, half) as MessageRow[];
      const centerRow = this.db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id = ?`)
        .get(channelId, around) as MessageRow | undefined;
      const afterRows = this.db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`)
        .all(channelId, around, half) as MessageRow[];
      rows = [...beforeRows.reverse(), ...(centerRow ? [centerRow] : []), ...afterRows];
    } else {
      rows = this.db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? ORDER BY m.id DESC LIMIT ?`)
        .all(channelId, limit) as MessageRow[];
    }

    return rows.map(toMessage);
  }

  getById(channelId: string, messageId: string): Message | null {
    const row = this.db.prepare(`${MSG_SELECT} WHERE m.id = ? AND m.channel_id = ?`)
      .get(messageId, channelId) as MessageRow | undefined;
    return row ? toMessage(row) : null;
  }

  create(channelId: string, author: User, content: string): Message {
    const now = Date.now();
    const id = generateSnowflake();

    this.db.prepare(
      "INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, channelId, author.id, author.username, content, now, null, null);

    return {
      id,
      channel_id: channelId,
      content,
      author,
      timestamp: new Date(now).toISOString(),
      edited_timestamp: null,
      type: 0,
    };
  }

  update(channelId: string, messageId: string, content: string): Message | null {
    const editedTimestamp = Date.now();
    const result = this.db.prepare(
      "UPDATE messages SET content = ?, edited_timestamp = ? WHERE id = ? AND channel_id = ?"
    ).run(content, editedTimestamp, messageId, channelId);

    if (result.changes === 0) return null;

    const row = this.db.prepare(`${MSG_SELECT} WHERE m.id = ? AND m.channel_id = ?`)
      .get(messageId, channelId) as MessageRow;
    return toMessage(row);
  }

  delete(channelId: string, messageId: string): boolean {
    const result = this.db.prepare("DELETE FROM messages WHERE id = ? AND channel_id = ?")
      .run(messageId, channelId);
    return result.changes > 0;
  }

  deleteAll(channelId: string): number {
    const result = this.db.prepare("DELETE FROM messages WHERE channel_id = ?").run(channelId);
    return result.changes;
  }
}
