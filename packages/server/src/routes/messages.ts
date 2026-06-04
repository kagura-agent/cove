import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { requireGuildMember } from "./helpers.js";

export function messagesRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/channels/:id/messages", (c) => {
    const channelId = c.req.param("id");
    const userId = c.get("botUser").id;
    const channel = requireGuildMember(repos, channelId, userId);
    if (!channel) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    const rawLimit = parseInt(c.req.query("limit") ?? "50", 10);
    const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 100);
    const before = c.req.query("before");
    const after = c.req.query("after");
    const around = c.req.query("around");

    const messages = repos.messages.list(channelId, { limit, before, after, around });
    return c.json(messages);
  });

  app.get("/channels/:id/messages/:msgId", (c) => {
    const channelId = c.req.param("id");
    const msgId = c.req.param("msgId");
    const userId = c.get("botUser").id;
    const ch = requireGuildMember(repos, channelId, userId);
    if (!ch) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    const message = repos.messages.getById(channelId, msgId);
    if (!message) {
      return c.json({ message: "Unknown Message", code: 10008 }, 404);
    }
    return c.json(message);
  });

  app.post("/channels/:id/messages", async (c) => {
    const channelId = c.req.param("id");
    const userId = c.get("botUser").id;
    const channel = requireGuildMember(repos, channelId, userId);
    if (!channel) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    const body = await parseJsonBody<{ content: string; username?: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.content, "content", { required: true, maxLength: 4000 });
    if (err) return validationError(c, err);

    const author = c.get("botUser");

    const message = repos.messages.create(channelId, author, body.content);

    dispatcher?.messageCreate(message);

    return c.json(message, 201);
  });

  app.patch("/channels/:id/messages/:msgId", async (c) => {
    const channelId = c.req.param("id");
    const msgId = c.req.param("msgId");
    const userId = c.get("botUser").id;
    const ch = requireGuildMember(repos, channelId, userId);
    if (!ch) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    const body = await parseJsonBody<{ content: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.content, "content", { required: true, maxLength: 4000 });
    if (err) return validationError(c, err);

    const updated = repos.messages.update(channelId, msgId, body.content);
    if (!updated) {
      return c.json({ message: "Unknown Message", code: 10008 }, 404);
    }

    dispatcher?.messageUpdate(updated);

    return c.json(updated);
  });

  app.delete("/channels/:id/messages/:msgId", (c) => {
    const channelId = c.req.param("id");
    const msgId = c.req.param("msgId");
    const userId = c.get("botUser").id;
    const ch = requireGuildMember(repos, channelId, userId);
    if (!ch) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    if (!repos.messages.delete(channelId, msgId)) {
      return c.json({ message: "Unknown Message", code: 10008 }, 404);
    }

    dispatcher?.messageDelete(channelId, msgId);

    return c.body(null, 204);
  });

  app.delete("/channels/:id/messages", (c) => {
    const channelId = c.req.param("id");
    const userId = c.get("botUser").id;
    const ch = requireGuildMember(repos, channelId, userId);
    if (!ch) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }
    const deleted = repos.messages.deleteAll(channelId!);
    return c.json({ deleted });
  });

  app.put("/channels/:id/messages/:msgId/ack", (c) => {
    const channelId = c.req.param("id");
    const messageId = c.req.param("msgId");
    const userId = c.get("botUser").id;
    const ch = requireGuildMember(repos, channelId, userId);
    if (!ch) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    repos.readStates.set(userId, channelId, messageId);
    dispatcher?.messageAck(userId, channelId, messageId);

    return c.body(null, 204);
  });

  app.post("/channels/:id/typing", (c) => {
    const channelId = c.req.param("id");
    const author = c.get("botUser");
    const ch = requireGuildMember(repos, channelId, author.id);
    if (!ch) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    dispatcher?.typingStart(channelId, { id: author.id, username: author.username }, ch.guild_id);

    return c.body(null, 204);
  });

  return app;
}
