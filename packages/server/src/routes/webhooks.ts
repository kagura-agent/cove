import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { requireChannelPermission, requireGuildPermission } from "./helpers.js";
import { PermissionBits } from "@cove/shared";
import { WebhookType } from "../repos/webhooks.js";

function stripToken<T extends { token?: unknown }>(webhook: T): Omit<T, "token"> {
  const { token: _, ...rest } = webhook;
  return rest;
}

export function webhookRoutes(repos: Repos): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/channels/:channelId/webhooks", async (c) => {
    const user = c.get("botUser");
    const channelId = c.req.param("channelId");
    const channel = await requireChannelPermission(repos, channelId, user.id, PermissionBits.MANAGE_WEBHOOKS);

    const body = await parseJsonBody<{ name: string; avatar?: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.name, "name", { required: true, maxLength: 80 });
    if (err) return validationError(c, err);

    if (body.avatar !== undefined) {
      const avatarErr = validateString(body.avatar, "avatar", { maxLength: 2048 });
      if (avatarErr) return validationError(c, avatarErr);
    }

    const webhook = repos.webhooks.create(channelId, channel.guild_id, body.name, body.avatar);
    return c.json(webhook, 201);
  });

  app.get("/channels/:channelId/webhooks", async (c) => {
    const user = c.get("botUser");
    const channelId = c.req.param("channelId");
    await requireChannelPermission(repos, channelId, user.id, PermissionBits.MANAGE_WEBHOOKS);

    return c.json(repos.webhooks.listByChannel(channelId));
  });

  app.get("/guilds/:guildId/webhooks", async (c) => {
    const user = c.get("botUser");
    const guildId = c.req.param("guildId");
    await requireGuildPermission(repos, guildId, user.id, PermissionBits.MANAGE_WEBHOOKS);

    return c.json(repos.webhooks.listByGuild(guildId));
  });

  app.get("/webhooks/:webhookId", async (c) => {
    const user = c.get("botUser");
    const webhookId = c.req.param("webhookId");
    const webhook = repos.webhooks.findById(webhookId);
    if (!webhook || webhook.type === WebhookType.INTERNAL) {
      return c.json({ message: "Unknown Webhook", code: 10015 }, 404);
    }

    await requireChannelPermission(repos, webhook.channel_id, user.id, PermissionBits.MANAGE_WEBHOOKS);

    return c.json(stripToken(webhook));
  });

  app.patch("/webhooks/:webhookId", async (c) => {
    const user = c.get("botUser");
    const webhookId = c.req.param("webhookId");
    const webhook = repos.webhooks.findById(webhookId);
    if (!webhook) return c.json({ message: "Unknown Webhook", code: 10015 }, 404);

    if (webhook.type === WebhookType.INTERNAL) {
      return c.json({ message: "Cannot modify internal webhook", code: 50013 }, 403);
    }

    await requireChannelPermission(repos, webhook.channel_id, user.id, PermissionBits.MANAGE_WEBHOOKS);

    const body = await parseJsonBody<{ name?: string; avatar?: string | null }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    if (body.name !== undefined) {
      const err = validateString(body.name, "name", { required: true, maxLength: 80 });
      if (err) return validationError(c, err);
    }

    if (body.avatar !== undefined && body.avatar !== null) {
      const avatarErr = validateString(body.avatar, "avatar", { maxLength: 2048 });
      if (avatarErr) return validationError(c, avatarErr);
    }

    const updated = repos.webhooks.update(webhookId, {
      name: body.name,
      avatar: body.avatar,
    });
    if (!updated) return c.json({ message: "Unknown Webhook", code: 10015 }, 404);

    return c.json(stripToken(updated));
  });

  app.delete("/webhooks/:webhookId", async (c) => {
    const user = c.get("botUser");
    const webhookId = c.req.param("webhookId");
    const webhook = repos.webhooks.findById(webhookId);
    if (!webhook) return c.json({ message: "Unknown Webhook", code: 10015 }, 404);

    if (webhook.type === WebhookType.INTERNAL) {
      return c.json({ message: "Cannot delete internal webhook", code: 50013 }, 403);
    }

    await requireChannelPermission(repos, webhook.channel_id, user.id, PermissionBits.MANAGE_WEBHOOKS);

    repos.webhooks.delete(webhookId);
    return c.body(null, 204);
  });

  return app;
}

export function webhookExecuteRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const WINDOW_MS = 60_000;
  const MAX_REQUESTS = 30;
  const MAX_BUCKETS = 10_000;
  const buckets = new Map<string, number[]>();

  app.post("/webhooks/:webhookId/:webhookToken", async (c) => {
    const webhookId = c.req.param("webhookId");
    const webhookToken = c.req.param("webhookToken");

    const webhook = repos.webhooks.findByIdAndToken(webhookId, webhookToken);
    if (!webhook) return c.json({ message: "Unknown Webhook", code: 10015 }, 404);

    // Parse query parameters
    const wait = c.req.query('wait') === 'true';
    const threadId = c.req.query('thread_id');

    // Validate thread_id if provided
    let targetChannelId = webhook.channel_id;
    if (threadId) {
      const thread = repos.channels.getById(threadId);
      if (!thread || ![10, 11, 12].includes(thread.type) || thread.parent_id !== webhook.channel_id) {
        return c.json({ message: 'Unknown Channel', code: 10003 }, 404);
      }
      if (thread.thread_metadata?.archived) {
        return c.json({ message: 'This thread is archived', code: 50083 }, 403);
      }
      if (thread.thread_metadata?.locked) {
        return c.json({ message: 'This thread is locked', code: 50083 }, 403);
      }
      targetChannelId = threadId;
    }

    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const timestamps = buckets.get(webhookId) ?? [];
    const recent = timestamps.filter((t) => t > windowStart);
    if (recent.length >= MAX_REQUESTS) {
      const retryAfter = Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ message: "You are being rate limited.", retry_after: retryAfter, global: false, code: 0 }, 429);
    }
    recent.push(now);
    buckets.set(webhookId, recent);

    for (const [key, ts] of buckets) {
      const active = ts.filter((t) => t > windowStart);
      if (active.length === 0) buckets.delete(key);
      else buckets.set(key, active);
    }
    if (buckets.size > MAX_BUCKETS) {
      const entries = [...buckets.entries()].sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]));
      const removeCount = Math.floor(entries.length / 2);
      for (let i = 0; i < removeCount; i++) buckets.delete(entries[i][0]);
    }

    const body = await parseJsonBody<{ content: string; username?: string; avatar_url?: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.content, "content", { required: true, maxLength: 4000 });
    if (err) return validationError(c, err);

    if (body.username !== undefined) {
      const usernameErr = validateString(body.username, "username", { maxLength: 80 });
      if (usernameErr) return validationError(c, usernameErr);
    }
    if (body.avatar_url !== undefined) {
      const avatarErr = validateString(body.avatar_url, "avatar_url", { maxLength: 2048 });
      if (avatarErr) return validationError(c, avatarErr);
    }

    // Allow per-execution overrides for username and avatar (Discord-compatible)
    const displayName = body.username ?? webhook.name;
    const displayAvatar = body.avatar_url ?? webhook.avatar;

    const message = repos.messages.createFromWebhook(
      targetChannelId,
      webhook.id,
      displayName,
      displayAvatar,
      body.content,
    );

    repos.channels.updateLastMessageId(targetChannelId, message.id);

    // Increment mention_count for each mentioned user
    if (message.mentions?.length) {
      for (const mentioned of message.mentions) {
        repos.readStates.incrementMentionCount(mentioned.id, targetChannelId);
      }
    }

    // If posting to a thread, increment message count
    if (threadId) {
      repos.threads.incrementMessageCount(targetChannelId);
    }

    dispatcher?.messageCreate(message);

    // Discord-compatible: default is 204 No Content (breaking change from always-201)
    if (wait) {
      return c.json(message, 200);
    }
    return c.body(null, 204);
  });

  return app;
}
