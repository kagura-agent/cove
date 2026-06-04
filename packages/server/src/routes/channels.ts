import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import { requireAuth, type AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { requireGuildMember } from "./helpers.js";

export function channelRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(repos.users);

  app.get("/api/v10/guilds/:guildId/channels", auth, (c) => {
    const guildId = c.req.param("guildId")!;
    if (!repos.guilds.exists(guildId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }
    const userId = c.get("botUser").id;
    if (!repos.members.exists(guildId, userId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }
    return c.json(repos.channels.list(guildId));
  });

  app.get("/api/v10/channels/:id", (c) => {
    const id = c.req.param("id")!;
    const userId = c.get("botUser").id;
    const channel = requireGuildMember(repos, id, userId);
    if (!channel) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }
    return c.json(channel);
  });

  app.post("/api/v10/guilds/:guildId/channels", auth, async (c) => {
    const guildId = c.req.param("guildId")!;
    if (!repos.guilds.exists(guildId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }
    const userId = c.get("botUser").id;
    if (!repos.members.exists(guildId, userId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    const body = await parseJsonBody<{ name: string; topic?: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.name, "name", { required: true, maxLength: 100 });
    if (err) return validationError(c, err);

    const name = body.name.trim();

    const channel = repos.channels.create(guildId, name, body.topic);
    return c.json(channel, 201);
  });

  app.patch("/api/v10/channels/:id", async (c) => {
    const id = c.req.param("id")!;
    const userId = c.get("botUser").id;
    const channel = requireGuildMember(repos, id, userId);
    if (!channel) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    const body = await parseJsonBody<{
      name?: string;
      topic?: string;
      position?: number;
      type?: number;
    }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const errors: string[] = [];
    let err = validateString(body.name, "name", { maxLength: 100 });
    if (err) errors.push(err);
    err = validateString(body.topic, "topic", { maxLength: 1024 });
    if (err) errors.push(err);
    if (errors.length > 0) return validationError(c, errors[0]);

    const { name, topic, position, type } = body;
    if (name === undefined && topic === undefined && position === undefined && type === undefined) {
      return c.json(channel);
    }

    const updated = repos.channels.update(id, body)!;

    dispatcher?.channelUpdate(updated);

    return c.json(updated);
  });

  app.delete("/api/v10/channels/:id", auth, (c) => {
    const id = c.req.param("id")!;
    const userId = c.get("botUser").id;
    const ch = requireGuildMember(repos, id, userId);
    if (!ch) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }
    if (!repos.channels.delete(id)) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }
    return c.json({ deleted: true });
  });

  return app;
}
