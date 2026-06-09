import type Database from "better-sqlite3";
import type { Reaction } from "@cove/shared";

interface ReactionRow {
  emoji: string;
  count: number;
  me: number;
}

interface ReactionRowWithMessage extends ReactionRow {
  message_id: string;
}

export class ReactionsRepo {
  constructor(private db: Database.Database) {}

  add(messageId: string, userId: string, emoji: string): boolean {
    const result = this.db.prepare(
      "INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)"
    ).run(messageId, userId, emoji, Date.now());
    return result.changes > 0;
  }

  remove(messageId: string, userId: string, emoji: string): boolean {
    const result = this.db.prepare(
      "DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?"
    ).run(messageId, userId, emoji);
    return result.changes > 0;
  }

  getCount(messageId: string, emoji: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM reactions WHERE message_id = ? AND emoji = ?"
    ).get(messageId, emoji) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  getForMessage(messageId: string, currentUserId?: string): Reaction[] {
    const rows = this.db.prepare(`
      SELECT emoji,
             COUNT(*) as count,
             COALESCE(SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END), 0) as me
      FROM reactions
      WHERE message_id = ?
      GROUP BY emoji
      ORDER BY MIN(created_at)
    `).all(currentUserId ?? "", messageId) as ReactionRow[];

    return rows.map((r) => ({
      emoji: { id: null, name: r.emoji },
      count: r.count,
      me: r.me > 0,
    }));
  }

  getForMessages(messageIds: string[], currentUserId?: string): Map<string, Reaction[]> {
    const result = new Map<string, Reaction[]>();
    if (messageIds.length === 0) return result;

    const placeholders = messageIds.map(() => "?").join(",");
    const rows = this.db.prepare(`
      SELECT message_id, emoji,
             COUNT(*) as count,
             COALESCE(SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END), 0) as me
      FROM reactions
      WHERE message_id IN (${placeholders})
      GROUP BY message_id, emoji
      ORDER BY message_id, MIN(created_at)
    `).all(currentUserId ?? "", ...messageIds) as ReactionRowWithMessage[];

    for (const row of rows) {
      const list = result.get(row.message_id) ?? [];
      list.push({
        emoji: { id: null, name: row.emoji },
        count: row.count,
        me: row.me > 0,
      });
      result.set(row.message_id, list);
    }
    return result;
  }

  getUsersForReaction(messageId: string, emoji: string, limit = 25, after?: string): { id: string; username: string; avatar: string | null; bot: number }[] {
    let query = `
      SELECT u.id, u.username, u.avatar, u.bot
      FROM reactions r JOIN users u ON r.user_id = u.id
      WHERE r.message_id = ? AND r.emoji = ?`;
    const params: (string | number)[] = [messageId, emoji];

    if (after) {
      query += ` AND (r.created_at, r.user_id) > ((SELECT created_at FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?), ?)`;
      params.push(messageId, after, emoji, after);
    }

    query += ` ORDER BY r.created_at, r.user_id LIMIT ?`;
    params.push(limit);

    return this.db.prepare(query).all(...params) as { id: string; username: string; avatar: string | null; bot: number }[];
  }
}
