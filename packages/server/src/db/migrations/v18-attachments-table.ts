import type Database from "better-sqlite3";
import { tableExists } from "./util.js";

/**
 * Migrate attachments from JSON column (v17) to a dedicated table.
 *
 * v17 added a `messages.attachments` TEXT column. This migration creates a
 * normalised `attachments` table and copies any data that was stored in the
 * JSON column. The column itself is left in place (SQLite cannot DROP COLUMN
 * on older versions) but is no longer read by application code.
 */
export function migrateV18(db: Database.Database): void {
  if (!tableExists(db, "attachments")) {
    db.exec(`
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        description TEXT,
        content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size INTEGER NOT NULL DEFAULT 0,
        url TEXT NOT NULL,
        proxy_url TEXT,
        width INTEGER,
        height INTEGER,
        ephemeral INTEGER DEFAULT 0,
        flags INTEGER DEFAULT 0,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_attachments_message ON attachments(message_id);
    `);
  }

  // Migrate any existing JSON data from the v17 column to the new table
  if (tableExists(db, "messages")) {
    const cols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === "attachments")) {
      const rows = db
        .prepare("SELECT id, channel_id, attachments FROM messages WHERE attachments IS NOT NULL AND attachments != '[]'")
        .all() as Array<{ id: string; channel_id: string; attachments: string }>;
      const insert = db.prepare(
        "INSERT OR IGNORE INTO attachments (id, message_id, channel_id, guild_id, filename, content_type, size, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const row of rows) {
        try {
          const atts = JSON.parse(row.attachments);
          for (const att of atts) {
            // Extract guild_id from URL: /api/v10/attachments/{guild_id}/...
            const urlParts = att.url?.split("/") || [];
            const guildIdx = urlParts.indexOf("attachments");
            const guildId = guildIdx >= 0 ? urlParts[guildIdx + 1] : "";
            insert.run(
              att.id,
              row.id,
              row.channel_id,
              guildId,
              att.filename,
              att.content_type || "application/octet-stream",
              att.size || 0,
              att.url
            );
          }
        } catch {
          // Skip malformed JSON rows
        }
      }
    }
  }
}
