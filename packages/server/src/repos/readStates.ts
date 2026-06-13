import type Database from "better-sqlite3";

export class ReadStatesRepo {
  constructor(private db: Database.Database) {}

  get(userId: string, channelId: string): { last_read_message_id: string | null; mention_count: number } | undefined {
    const row = this.db.prepare(
      "SELECT last_read_message_id, mention_count FROM read_states WHERE user_id = ? AND channel_id = ?"
    ).get(userId, channelId) as { last_read_message_id: string | null; mention_count: number } | undefined;
    return row;
  }

  /** Returns true when the cursor actually advanced, false when skipped by monotonicity guard. */
  set(userId: string, channelId: string, messageId: string): boolean {
    // Only advance the cursor forward — a delayed ack must not overwrite a newer one.
    // Snowflake IDs are fixed-width numeric strings; lexicographic >= is equivalent to numeric >=.
    // Also reset mention_count to 0 when acking.
    const result = this.db.prepare(`
      INSERT INTO read_states (user_id, channel_id, last_read_message_id, mention_count) VALUES (?, ?, ?, 0)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id, mention_count = 0
      WHERE excluded.last_read_message_id >= COALESCE(read_states.last_read_message_id, '0')
    `).run(userId, channelId, messageId);
    return result.changes > 0;
  }

  /** Increment mention_count for a user in a channel. */
  incrementMentionCount(userId: string, channelId: string): void {
    this.db.prepare(`
      INSERT INTO read_states (user_id, channel_id, last_read_message_id, mention_count) VALUES (?, ?, NULL, 1)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET mention_count = mention_count + 1
    `).run(userId, channelId);
  }

  getAllForUserWithLastMessage(userId: string): Array<{ channel_id: string; last_read_message_id: string | null; last_message_id: string | null; mention_count: number }> {
    // Return every channel the user belongs to, with their read cursor and the latest message ID.
    // Channels with no read_state row will have last_read_message_id = null (unread).
    return this.db.prepare(`
      SELECT c.id AS channel_id,
        rs.last_read_message_id,
        c.last_message_id,
        COALESCE(rs.mention_count, 0) AS mention_count
      FROM channels c
      JOIN guild_members gm ON gm.guild_id = c.guild_id AND gm.user_id = ?
      LEFT JOIN read_states rs ON rs.channel_id = c.id AND rs.user_id = ?
    `).all(userId, userId) as Array<{ channel_id: string; last_read_message_id: string | null; last_message_id: string | null; mention_count: number }>;
  }
}
