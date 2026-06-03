import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";

export function messagesRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/api/v10/channels/:id/messages", (c) => {
    const channelId = c.req.param("id");

    if (!repos.channels.exists(channelId)) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 100);
    const before = c.req.query("before");
    const after = c.req.query("after");
    const around = c.req.query("around");

    const messages = repos.messages.list(channelId, { limit, before, after, around });
    return c.json(messages);
  });

  app.get("/api/v10/channels/:id/messages/:msgId", (c) => {
    const channelId = c.req.param("id");
    const msgId = c.req.param("msgId");

    const message = repos.messages.getById(channelId, msgId);
    if (!message) {
      return c.json({ message: "Unknown Message", code: 10008 }, 404);
    }
    return c.json(message);
  });

  app.post("/api/v10/channels/:id/messages", async (c) => {
    const channelId = c.req.param("id");

    if (!repos.channels.exists(channelId)) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    const body = await c.req.json<{ content: string; username?: string }>();
    const author = c.get("botUser");

    const message = repos.messages.create(channelId, author, body.content);

    dispatcher?.messageCreate(message);

    return c.json(message, 201);
  });

  app.patch("/api/v10/channels/:id/messages/:msgId", async (c) => {
    const channelId = c.req.param("id");
    const msgId = c.req.param("msgId");
    const body = await c.req.json<{ content: string }>();

    const updated = repos.messages.update(channelId, msgId, body.content);
    if (!updated) {
      return c.json({ message: "Unknown Message", code: 10008 }, 404);
    }

    dispatcher?.messageUpdate(updated);

    return c.json(updated);
  });

  app.delete("/api/v10/channels/:id/messages/:msgId", (c) => {
    const channelId = c.req.param("id");
    const msgId = c.req.param("msgId");

    if (!repos.messages.delete(channelId, msgId)) {
      return c.json({ message: "Unknown Message", code: 10008 }, 404);
    }

    dispatcher?.messageDelete(channelId, msgId);

    return c.body(null, 204);
  });

  app.delete("/api/v10/channels/:id/messages", (c) => {
    const channelId = c.req.param("id");
    const deleted = repos.messages.deleteAll(channelId!);
    return c.json({ deleted });
  });

  app.post("/api/v10/channels/:id/typing", (c) => {
    const channelId = c.req.param("id");
    const author = c.get("botUser");

    dispatcher?.typingStart(channelId, { id: author.id, username: author.username });

    return c.body(null, 204);
  });

  return app;
}
