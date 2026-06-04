import type Database from "better-sqlite3";

interface ReadStateRow {
  user_id: string;
  channel_id: string;
  last_read_message_id: string | null;
}

export class ReadStatesRepo {
  constructor(private db: Database.Database) {}

  get(userId: string, channelId: string): { last_read_message_id: string | null } | undefined {
    const row = this.db.prepare(
      "SELECT last_read_message_id FROM read_states WHERE user_id = ? AND channel_id = ?"
    ).get(userId, channelId) as Pick<ReadStateRow, "last_read_message_id"> | undefined;
    return row;
  }

  set(userId: string, channelId: string, messageId: string): void {
    this.db.prepare(
      "INSERT INTO read_states (user_id, channel_id, last_read_message_id) VALUES (?, ?, ?) ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id"
    ).run(userId, channelId, messageId);
  }

  getAllForUser(userId: string): Array<{ channel_id: string; last_read_message_id: string | null }> {
    return this.db.prepare(
      "SELECT channel_id, last_read_message_id FROM read_states WHERE user_id = ?"
    ).all(userId) as Array<{ channel_id: string; last_read_message_id: string | null }>;
  }
}
