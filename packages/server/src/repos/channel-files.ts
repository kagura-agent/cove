import type Database from "better-sqlite3";

const MAX_FILE_SIZE = 100 * 1024; // 100KB

export interface ChannelFile {
  channel_id: string;
  filename: string;
  content: string;
  content_type: string;
  size: number;
  created_at: number;
  updated_at: number;
}

export type ChannelFileMeta = Omit<ChannelFile, "content">;

export class ChannelFilesRepo {
  constructor(private db: Database.Database) {}

  list(channelId: string): ChannelFileMeta[] {
    const rows = this.db
      .prepare(
        `SELECT channel_id, filename, content_type, size, created_at, updated_at
         FROM channel_files
         WHERE channel_id = ?
         ORDER BY
           CASE WHEN filename = 'cove.md' THEN 0 ELSE 1 END,
           filename ASC`
      )
      .all(channelId) as ChannelFileMeta[];
    return rows;
  }

  get(channelId: string, filename: string): ChannelFile | null {
    const row = this.db
      .prepare("SELECT * FROM channel_files WHERE channel_id = ? AND filename = ?")
      .get(channelId, filename) as ChannelFile | undefined;
    return row ?? null;
  }

  upsert(
    channelId: string,
    filename: string,
    content: string,
    contentType: string = "text/plain"
  ): ChannelFile | null {
    const size = Buffer.byteLength(content, "utf8");
    if (size > MAX_FILE_SIZE) return null;

    const now = Date.now();

    // Check if file exists to preserve created_at
    const existing = this.db
      .prepare("SELECT created_at FROM channel_files WHERE channel_id = ? AND filename = ?")
      .get(channelId, filename) as { created_at: number } | undefined;

    const createdAt = existing?.created_at ?? now;

    this.db
      .prepare(
        `INSERT INTO channel_files (channel_id, filename, content, content_type, size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, filename)
         DO UPDATE SET content = excluded.content, content_type = excluded.content_type, size = excluded.size, updated_at = excluded.updated_at`
      )
      .run(channelId, filename, content, contentType, size, createdAt, now);

    return {
      channel_id: channelId,
      filename,
      content,
      content_type: contentType,
      size,
      created_at: createdAt,
      updated_at: now,
    };
  }

  delete(channelId: string, filename: string): boolean {
    const result = this.db
      .prepare("DELETE FROM channel_files WHERE channel_id = ? AND filename = ?")
      .run(channelId, filename);
    return result.changes > 0;
  }
}
