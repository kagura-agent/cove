import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { requireChannelPermission } from "./helpers.js";
import { PermissionBits } from "@cove/shared";
import type { IncomingMessageRequest } from "@cove/shared";

export function incomingRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const WINDOW_MS = 60_000;
  const MAX_REQUESTS = 30;
  const MAX_BUCKETS = 10_000;
  const buckets = new Map<string, number[]>();

  app.post("/channels/:channelId/incoming", async (c) => {
    const user = c.get("botUser");
    const channelId = c.req.param("channelId");
    const channel = await requireChannelPermission(repos, channelId, user.id, PermissionBits.SEND_MESSAGES);

    const body = await parseJsonBody<IncomingMessageRequest>(c);
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

    let webhook = repos.webhooks.findInternalByChannel(channelId);
    if (!webhook) {
      webhook = repos.webhooks.createInternal(channelId, channel.guild_id);
    }

    let targetChannelId = channelId;
    if (body.thread_id) {
      const thread = repos.channels.getById(body.thread_id);
      if (!thread || ![10, 11, 12].includes(thread.type) || thread.parent_id !== channelId) {
        return c.json({ message: "Unknown Channel", code: 10003 }, 404);
      }
      if (thread.thread_metadata?.archived) {
        return c.json({ message: "This thread is archived", code: 50083 }, 403);
      }
      if (thread.thread_metadata?.locked) {
        return c.json({ message: "This thread is locked", code: 50083 }, 403);
      }
      targetChannelId = body.thread_id;
    }

    // Rate limit
    if (process.env.RATE_LIMIT_ENABLED !== "false") {
      const now = Date.now();
      const windowStart = now - WINDOW_MS;
      const timestamps = buckets.get(webhook.id) ?? [];
      const recent = timestamps.filter((t) => t > windowStart);
      if (recent.length >= MAX_REQUESTS) {
        const retryAfter = Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
        c.header("Retry-After", String(retryAfter));
        return c.json({ message: "You are being rate limited.", retry_after: retryAfter, global: false, code: 0 }, 429);
      }
      recent.push(now);
      buckets.set(webhook.id, recent);

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
    }

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

    if (message.mentions?.length) {
      for (const mentioned of message.mentions) {
        repos.readStates.incrementMentionCount(mentioned.id, targetChannelId);
      }
    }

    if (body.thread_id) {
      repos.threads.incrementMessageCount(targetChannelId);
    }

    dispatcher?.messageCreate(message);

    return c.json(message, 200);
  });

  return app;
}
