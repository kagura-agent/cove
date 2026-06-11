import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { requireGuildMember, requireBotChannelPermission, unknownChannel, unknownMessage } from "./helpers.js";

export function messagesRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/channels/:id/messages", (c) => {
    const channelId = c.req.param("id");
    const user = c.get("botUser");
    const channel = requireGuildMember(repos, channelId, user.id);
    if (!channel) {
      return unknownChannel(c);
    }
    if (!requireBotChannelPermission(repos, channelId, user.id, user.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const rawLimit = parseInt(c.req.query("limit") ?? "50", 10);
    const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 100);
    const before = c.req.query("before");
    const after = c.req.query("after");
    const around = c.req.query("around");

    const messages = repos.messages.list(channelId, { limit, before, after, around }, user.id);
    return c.json(messages);
  });

  app.get("/channels/:id/messages/:msgId", (c) => {
    const channelId = c.req.param("id");
    const msgId = c.req.param("msgId");
    const user = c.get("botUser");
    const ch = requireGuildMember(repos, channelId, user.id);
    if (!ch) {
      return unknownChannel(c);
    }
    if (!requireBotChannelPermission(repos, channelId, user.id, user.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const message = repos.messages.getById(channelId, msgId, user.id);
    if (!message) {
      return unknownMessage(c);
    }
    return c.json(message);
  });

  app.post("/channels/:id/messages", async (c) => {
    const channelId = c.req.param("id");
    const user = c.get("botUser");
    const channel = requireGuildMember(repos, channelId, user.id);
    if (!channel) {
      return unknownChannel(c);
    }
    if (!requireBotChannelPermission(repos, channelId, user.id, user.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const body = await parseJsonBody<{ content: string; username?: string; nonce?: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.content, "content", { required: true, maxLength: 4000 });
    if (err) return validationError(c, err);

    // Validate nonce before DB write to prevent orphan records
    if (body.nonce) {
      if (typeof body.nonce !== "string" || body.nonce.length > 64) {
        return validationError(c, "nonce must be a string of at most 64 characters");
      }
    }

    const author = user;

    const message = repos.messages.create(channelId, author, body.content);

    // Pass through client nonce for optimistic send reconciliation
    if (body.nonce) {
      message.nonce = body.nonce;
    }

    // Update channel's last_message_id
    repos.channels.updateLastMessageId(channelId, message.id);

    // Update sender's read state so their own message doesn't show unread on reload
    const acked = repos.readStates.set(user.id, channelId, message.id);

    dispatcher?.messageCreate(message);

    // Notify sender's other sessions so unread badges clear everywhere
    if (acked) {
      dispatcher?.messageAck(user.id, channelId, message.id);
    }

    return c.json(message, 201);
  });

  app.patch("/channels/:id/messages/:msgId", async (c) => {
    const channelId = c.req.param("id");
    const msgId = c.req.param("msgId");
    const user = c.get("botUser");
    const ch = requireGuildMember(repos, channelId, user.id);
    if (!ch) {
      return unknownChannel(c);
    }
    if (!requireBotChannelPermission(repos, channelId, user.id, user.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const existing = repos.messages.getById(channelId, msgId);
    if (!existing) {
      return unknownMessage(c);
    }

    // Only the message author can edit their own message
    if (existing.author.id !== user.id) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const body = await parseJsonBody<{ content: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.content, "content", { required: true, maxLength: 4000 });
    if (err) return validationError(c, err);

    const updated = repos.messages.update(channelId, msgId, body.content);
    if (!updated) {
      return unknownMessage(c);
    }

    dispatcher?.messageUpdate(updated);

    return c.json(updated);
  });

  app.delete("/channels/:id/messages/:msgId", (c) => {
    const channelId = c.req.param("id");
    const msgId = c.req.param("msgId");
    const user = c.get("botUser");
    const ch = requireGuildMember(repos, channelId, user.id);
    if (!ch) {
      return unknownChannel(c);
    }
    if (!requireBotChannelPermission(repos, channelId, user.id, user.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const existing = repos.messages.getById(channelId, msgId);
    if (!existing) {
      return unknownMessage(c);
    }

    // TODO: check MANAGE_MESSAGES permission once permission system is implemented (#113)
    // For now, any guild member can delete any message in channels they have access to

    if (!repos.messages.delete(channelId, msgId)) {
      return unknownMessage(c);
    }

    // Recompute last_message_id if we just deleted the latest message
    if (ch.last_message_id === msgId) {
      repos.channels.recomputeLastMessageId(channelId);
    }

    dispatcher?.messageDelete(channelId, msgId);

    return c.body(null, 204);
  });

  // TODO: check MANAGE_MESSAGES permission once permission system is implemented (#113)
  app.post("/channels/:id/messages/bulk-delete", async (c) => {
    const channelId = c.req.param("id");
    const user = c.get("botUser");
    const ch = requireGuildMember(repos, channelId, user.id);
    if (!ch) {
      return unknownChannel(c);
    }
    if (!requireBotChannelPermission(repos, channelId, user.id, user.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const body = await parseJsonBody<{ messages: string[] }>(c);
    if (!body) return validationError(c, "Invalid JSON");
    if (!Array.isArray(body.messages) || body.messages.length < 2) {
      return validationError(c, "messages must contain between 2 and 100 items");
    }
    if (body.messages.length > 100) {
      return validationError(c, "messages must contain between 2 and 100 items");
    }

    const deleted: string[] = [];
    repos.db.transaction(() => {
      for (const msgId of body.messages) {
        if (repos.messages.delete(channelId, msgId)) {
          deleted.push(msgId);
        }
      }
    })();
    if (deleted.length > 0) {
      repos.channels.recomputeLastMessageId(channelId);
      dispatcher?.messageDeleteBulk(channelId, deleted, ch.guild_id);
    }

    return c.body(null, 204);
  });

  // Cove-specific: clear all messages in a channel
  app.delete("/channels/:id/messages", (c) => {
    const channelId = c.req.param("id");
    const user = c.get("botUser");
    const ch = requireGuildMember(repos, channelId, user.id);
    if (!ch) {
      return unknownChannel(c);
    }
    if (!requireBotChannelPermission(repos, channelId, user.id, user.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const count = repos.messages.deleteAll(channelId);
    if (count > 0) {
      repos.channels.recomputeLastMessageId(channelId);
    }

    return c.body(null, 204);
  });

  app.put("/channels/:id/messages/:msgId/ack", (c) => {
    const channelId = c.req.param("id");
    const messageId = c.req.param("msgId");
    const user = c.get("botUser");
    const ch = requireGuildMember(repos, channelId, user.id);
    if (!ch) {
      return unknownChannel(c);
    }
    if (!requireBotChannelPermission(repos, channelId, user.id, user.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    if (!repos.messages.getById(channelId, messageId)) {
      return unknownMessage(c);
    }

    repos.readStates.set(user.id, channelId, messageId) &&
      dispatcher?.messageAck(user.id, channelId, messageId);

    return c.body(null, 204);
  });

  app.post("/channels/:id/typing", (c) => {
    const channelId = c.req.param("id");
    const author = c.get("botUser");
    const ch = requireGuildMember(repos, channelId, author.id);
    if (!ch) {
      return unknownChannel(c);
    }
    if (!requireBotChannelPermission(repos, channelId, author.id, author.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    dispatcher?.typingStart(channelId, { id: author.id, username: author.username }, ch.guild_id);

    return c.body(null, 204);
  });

  return app;
}
