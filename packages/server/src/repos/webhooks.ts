import type Database from "better-sqlite3";
import { generateSnowflake, type Webhook } from "@cove/shared";
import crypto from "node:crypto";

interface WebhookRow {
  id: string;
  channel_id: string;
  guild_id: string;
  name: string;
  avatar: string | null;
  token: string;
  created_at: number;
}

function toWebhook(row: WebhookRow): Webhook {
  return {
    id: row.id,
    channel_id: row.channel_id,
    guild_id: row.guild_id,
    name: row.name,
    avatar: row.avatar,
    token: row.token,
  };
}

function toPublicWebhook(row: WebhookRow): Webhook {
  return {
    id: row.id,
    channel_id: row.channel_id,
    guild_id: row.guild_id,
    name: row.name,
    avatar: row.avatar,
  };
}

export class WebhooksRepo {
  constructor(private db: Database.Database) {}

  create(channelId: string, guildId: string, name: string, avatar?: string | null): Webhook {
    const id = generateSnowflake();
    const token = crypto.randomUUID();
    const now = Date.now();

    this.db.prepare(
      "INSERT INTO webhooks (id, channel_id, guild_id, name, avatar, token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, channelId, guildId, name, avatar ?? null, token, now);

    return { id, channel_id: channelId, guild_id: guildId, name, avatar: avatar ?? null, token };
  }

  findById(id: string): Webhook | null {
    const row = this.db.prepare("SELECT * FROM webhooks WHERE id = ?").get(id) as WebhookRow | undefined;
    return row ? toWebhook(row) : null;
  }

  findByToken(token: string): Webhook | null {
    const row = this.db.prepare("SELECT * FROM webhooks WHERE token = ?").get(token) as WebhookRow | undefined;
    return row ? toWebhook(row) : null;
  }

  findByIdAndToken(id: string, token: string): Webhook | null {
    const row = this.db.prepare("SELECT * FROM webhooks WHERE id = ? AND token = ?").get(id, token) as WebhookRow | undefined;
    return row ? toWebhook(row) : null;
  }

  listByChannel(channelId: string): Webhook[] {
    const rows = this.db.prepare("SELECT * FROM webhooks WHERE channel_id = ? ORDER BY created_at").all(channelId) as WebhookRow[];
    return rows.map(toPublicWebhook);
  }

  listByGuild(guildId: string): Webhook[] {
    const rows = this.db.prepare("SELECT * FROM webhooks WHERE guild_id = ? ORDER BY created_at").all(guildId) as WebhookRow[];
    return rows.map(toPublicWebhook);
  }

  update(id: string, fields: { name?: string; avatar?: string | null }): Webhook | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const name = fields.name ?? existing.name;
    const avatar = fields.avatar !== undefined ? fields.avatar : existing.avatar;

    this.db.prepare("UPDATE webhooks SET name = ?, avatar = ? WHERE id = ?").run(name, avatar, id);

    return { ...existing, name, avatar };
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM webhooks WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
