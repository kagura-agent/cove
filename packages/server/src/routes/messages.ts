import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { requireGuildMember, requireBotChannelPermission, unknownChannel, unknownMessage } from "./helpers.js";
import { generateSnowflake, type Attachment } from "@cove/shared";
import { storeAttachment } from "../attachment-storage.js";

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
    // Enrich messages with thread indicators
    for (const msg of messages) {
      const threadInfo = repos.threads.getThreadForMessage(msg.id);
      if (threadInfo) {
        msg.thread = threadInfo;
      }
    }
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
    // Enrich with thread indicator
    const threadInfo = repos.threads.getThreadForMessage(message.id);
    if (threadInfo) {
      message.thread = threadInfo;
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

    // Reject messages in archived or locked threads
    if (channel.type === 11 && channel.thread_metadata) {
      const meta = channel.thread_metadata;
      if (meta.archived) {
        return c.json({ message: 'This thread is archived', code: 50083 }, 403);
      }
      if (meta.locked) {
        return c.json({ message: 'This thread is locked', code: 50083 }, 403);
      }
    }

    const contentType = c.req.header('content-type') || '';
    let content = '';
    let nonce: string | undefined;
    let referencedMessageId: string | undefined;
    let attachmentList: Attachment[] = [];

    if (contentType.startsWith('multipart/form-data')) {
      const formBody = await c.req.parseBody({ all: true });
      const payloadRaw = formBody['payload_json'];
      const payload = typeof payloadRaw === 'string' ? JSON.parse(payloadRaw) : {};
      content = payload.content || '';
      nonce = payload.nonce;
      if (payload.message_reference?.message_id) {
        const refMsg = repos.messages.getById(channelId, payload.message_reference.message_id);
        if (!refMsg) return c.json({ message: 'Unknown Message', code: 10008 }, 400);
        referencedMessageId = payload.message_reference.message_id;
      }

      const files: File[] = [];
      for (const [key, value] of Object.entries(formBody)) {
        if (key.startsWith('files[') && value instanceof File) {
          files.push(value);
        }
      }

      for (const file of files) {
        const attId = generateSnowflake();
        const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const arrayBuffer = await file.arrayBuffer();
        await storeAttachment(channel.guild_id, channelId, attId, safeFilename, Buffer.from(arrayBuffer));
        attachmentList.push({
          id: attId,
          filename: file.name,
          size: file.size,
          url: '/attachments/' + channel.guild_id + '/' + channelId + '/' + attId + '/' + encodeURIComponent(safeFilename),
          content_type: file.type || 'application/octet-stream',
        });
      }
    } else {
      const body = await parseJsonBody<{ content: string; username?: string; nonce?: string; message_reference?: { message_id: string } }>(c);
      if (!body) return validationError(c, 'Invalid JSON');
      content = body.content;
      nonce = body.nonce;
      if (body.message_reference?.message_id) {
        if (typeof body.message_reference.message_id !== 'string') {
          return validationError(c, 'message_reference.message_id must be a string');
        }
        const refMsg = repos.messages.getById(channelId, body.message_reference.message_id);
        if (!refMsg) return c.json({ message: 'Unknown Message', code: 10008 }, 400);
        referencedMessageId = body.message_reference.message_id;
      }
    }

    // Allow empty content if attachments are present
    if (!content && attachmentList.length === 0) {
      return validationError(c, 'content is required when no attachments are provided');
    }
    if (content) {
      const err = validateString(content, 'content', { maxLength: 4000 });
      if (err) return validationError(c, err);
    }

    if (nonce) {
      if (typeof nonce !== 'string' || nonce.length > 64) {
        return validationError(c, 'nonce must be a string of at most 64 characters');
      }
    }

    const author = user;
    const message = repos.messages.create(channelId, author, content, referencedMessageId, attachmentList.length > 0 ? attachmentList : undefined);

    if (nonce) {
      message.nonce = nonce;
    }

    // Thread-specific: auto-add sender as member + increment message count
    if (channel.type === 11) {
      repos.threads.addMember(channelId, user.id);
      repos.threads.incrementMessageCount(channelId);
    }

    // Update channel's last_message_id
    repos.channels.updateLastMessageId(channelId, message.id);

    // Update sender's read state so their own message doesn't show unread on reload
    const acked = repos.readStates.set(user.id, channelId, message.id);

    // Increment mention_count for each mentioned user (except sender)
    if (message.mentions?.length) {
      for (const mentioned of message.mentions) {
        if (mentioned.id !== user.id) {
          repos.readStates.incrementMentionCount(mentioned.id, channelId);
        }
      }
    }

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

    // Increment mention_count for newly mentioned users (draft streaming may add mentions on edit)
    if (updated.mentions?.length) {
      const existingMentionIds = new Set(existing.mentions?.map((u) => u.id) ?? []);
      for (const mentioned of updated.mentions) {
        if (mentioned.id !== user.id && !existingMentionIds.has(mentioned.id)) {
          repos.readStates.incrementMentionCount(mentioned.id, channelId);
        }
      }
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

    // Thread-specific: decrement message count
    if (ch.type === 11) {
      repos.threads.decrementMessageCount(channelId);
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
      // Update thread message_count for bulk deletes
      if (ch.type === 11) {
        repos.threads.decrementMessageCountBy(channelId, deleted.length);
      }
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
      // Reset thread message_count when all messages are cleared
      if (ch.type === 11) {
        repos.threads.resetMessageCount(channelId);
      }
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
