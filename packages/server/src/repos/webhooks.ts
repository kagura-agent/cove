import type Database from "better-sqlite3";
import { generateSnowflake, type Webhook } from "@cove/shared";
import crypto from "node:crypto";

export const WebhookType = { USER: 1, INTERNAL: 2 } as const;

interface WebhookRow {
  id: string;
  channel_id: string;
  guild_id: string;
  name: string;
  avatar: string | null;
  token: string;
  type: number;
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
    type: row.type,
  };
}

function toPublicWebhook(row: WebhookRow): Webhook {
  return {
    id: row.id,
    channel_id: row.channel_id,
    guild_id: row.guild_id,
    name: row.name,
    avatar: row.avatar,
    type: row.type,
  };
}

export class WebhooksRepo {
  constructor(private db: Database.Database) {}

  create(channelId: string, guildId: string, name: string, avatar?: string | null, type: number = WebhookType.USER): Webhook {
    const id = generateSnowflake();
    const token = crypto.randomUUID();
    const now = Date.now();

    this.db.prepare(
      "INSERT INTO webhooks (id, channel_id, guild_id, name, avatar, token, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, channelId, guildId, name, avatar ?? null, token, type, now);

    return { id, channel_id: channelId, guild_id: guildId, name, avatar: avatar ?? null, token, type };
  }

  createInternal(channelId: string, guildId: string): Webhook {
    return this.create(channelId, guildId, "Internal", null, WebhookType.INTERNAL);
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

  findInternalByChannel(channelId: string): Webhook | null {
    const row = this.db.prepare("SELECT * FROM webhooks WHERE channel_id = ? AND type = 2 LIMIT 1").get(channelId) as WebhookRow | undefined;
    return row ? toWebhook(row) : null;
  }

  listByChannel(channelId: string, includeInternal = false): Webhook[] {
    const sql = includeInternal
      ? "SELECT * FROM webhooks WHERE channel_id = ? ORDER BY created_at"
      : "SELECT * FROM webhooks WHERE channel_id = ? AND type = 1 ORDER BY created_at";
    const rows = this.db.prepare(sql).all(channelId) as WebhookRow[];
    return rows.map(toPublicWebhook);
  }

  listByGuild(guildId: string, includeInternal = false): Webhook[] {
    const sql = includeInternal
      ? "SELECT * FROM webhooks WHERE guild_id = ? ORDER BY created_at"
      : "SELECT * FROM webhooks WHERE guild_id = ? AND type = 1 ORDER BY created_at";
    const rows = this.db.prepare(sql).all(guildId) as WebhookRow[];
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
