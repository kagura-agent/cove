import type Database from "better-sqlite3";

export class ReadStatesRepo {
  constructor(private db: Database.Database) {}

  get(userId: string, channelId: string): { last_read_message_id: string | null } | undefined {
    const row = this.db.prepare(
      "SELECT last_read_message_id FROM read_states WHERE user_id = ? AND channel_id = ?"
    ).get(userId, channelId) as { last_read_message_id: string | null } | undefined;
    return row;
  }

  /** Returns true when the cursor actually advanced, false when skipped by monotonicity guard. */
  set(userId: string, channelId: string, messageId: string): boolean {
    // Only advance the cursor forward — a delayed ack must not overwrite a newer one.
    // Compare by message timestamp since IDs are UUIDs (not sequential).
    const result = this.db.prepare(`
      INSERT INTO read_states (user_id, channel_id, last_read_message_id) VALUES (?, ?, ?)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id
      WHERE (SELECT timestamp FROM messages WHERE id = excluded.last_read_message_id)
            >= COALESCE((SELECT timestamp FROM messages WHERE id = read_states.last_read_message_id), 0)
    `).run(userId, channelId, messageId);
    return result.changes > 0;
  }

  getAllForUserWithLastMessage(userId: string): Array<{ channel_id: string; last_read_message_id: string | null; last_message_id: string | null }> {
    // Return every channel the user belongs to, with their read cursor and the latest message ID.
    // Channels with no read_state row will have last_read_message_id = null (unread).
    return this.db.prepare(`
      SELECT c.id AS channel_id,
        rs.last_read_message_id,
        (SELECT m.id FROM messages m WHERE m.channel_id = c.id ORDER BY m.timestamp DESC LIMIT 1) AS last_message_id
      FROM channels c
      JOIN guild_members gm ON gm.guild_id = c.guild_id AND gm.user_id = ?
      LEFT JOIN read_states rs ON rs.channel_id = c.id AND rs.user_id = ?
    `).all(userId, userId) as Array<{ channel_id: string; last_read_message_id: string | null; last_message_id: string | null }>;
  }
}
