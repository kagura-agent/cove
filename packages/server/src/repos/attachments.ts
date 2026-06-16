import type Database from "better-sqlite3";
import type { Attachment } from "@cove/shared";

export class AttachmentRepo {
  constructor(private db: Database.Database) {}

  createMany(messageId: string, channelId: string, guildId: string, attachments: Attachment[]): void {
    const stmt = this.db.prepare(
      "INSERT INTO attachments (id, message_id, channel_id, guild_id, filename, description, content_type, size, url, proxy_url, width, height, ephemeral, flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const att of attachments) {
      stmt.run(
        att.id,
        messageId,
        channelId,
        guildId,
        att.filename,
        att.description ?? null,
        att.content_type,
        att.size,
        att.url,
        att.proxy_url ?? null,
        att.width ?? null,
        att.height ?? null,
        att.ephemeral ? 1 : 0,
        att.flags ?? 0
      );
    }
  }

  getByMessageId(messageId: string): Attachment[] {
    const rows = this.db.prepare("SELECT * FROM attachments WHERE message_id = ?").all(messageId) as any[];
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      description: r.description ?? undefined,
      content_type: r.content_type,
      size: r.size,
      url: r.url,
      proxy_url: r.proxy_url ?? undefined,
      width: r.width ?? undefined,
      height: r.height ?? undefined,
      ephemeral: r.ephemeral === 1 ? true : undefined,
      flags: r.flags || undefined,
    }));
  }

  getByMessageIds(messageIds: string[]): Map<string, Attachment[]> {
    if (messageIds.length === 0) return new Map();
    const placeholders = messageIds.map(() => "?").join(",");
    const rows = this.db
      .prepare("SELECT * FROM attachments WHERE message_id IN (" + placeholders + ")")
      .all(...messageIds) as any[];
    const map = new Map<string, Attachment[]>();
    for (const r of rows) {
      const att: Attachment = {
        id: r.id,
        filename: r.filename,
        description: r.description ?? undefined,
        content_type: r.content_type,
        size: r.size,
        url: r.url,
        proxy_url: r.proxy_url ?? undefined,
        width: r.width ?? undefined,
        height: r.height ?? undefined,
      };
      const list = map.get(r.message_id) || [];
      list.push(att);
      map.set(r.message_id, list);
    }
    return map;
  }

  deleteByMessageId(messageId: string): void {
    this.db.prepare("DELETE FROM attachments WHERE message_id = ?").run(messageId);
  }
}
