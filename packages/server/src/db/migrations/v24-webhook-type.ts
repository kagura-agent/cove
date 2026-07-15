import type Database from "better-sqlite3";
import { generateSnowflake } from "@cove/shared";
import crypto from "node:crypto";

export function migrateV24(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(webhooks)").all() as { name: string }[];
  if (!cols.some(c => c.name === "type")) {
    db.prepare("ALTER TABLE webhooks ADD COLUMN type INTEGER NOT NULL DEFAULT 1").run();
  }

  const channels = db.prepare(
    `SELECT DISTINCT c.id, c.guild_id FROM channels c
     WHERE c.id NOT IN (SELECT channel_id FROM webhooks WHERE type = 2)`
  ).all() as { id: string; guild_id: string }[];

  const insert = db.prepare(
    "INSERT INTO webhooks (id, channel_id, guild_id, name, avatar, token, type, created_at) VALUES (?, ?, ?, ?, ?, ?, 2, ?)"
  );

  const now = Date.now();
  for (const ch of channels) {
    insert.run(generateSnowflake(), ch.id, ch.guild_id, "Internal", null, crypto.randomUUID(), now);
  }
}
