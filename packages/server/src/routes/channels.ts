import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import { requireAuth, type AppEnv } from "../auth.js";
import { validateString, validateFiniteNumber, validationError, parseJsonBody } from "../validation.js";
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

  app.get("/api/v10/channels/:id/state", (c) => {
    const channelId = c.req.param("id")!;
    const userId = c.get("botUser").id;
    const channel = requireGuildMember(repos, channelId, userId);
    if (!channel) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }
    return c.json(repos.state.list(channelId));
  });

  app.put("/api/v10/channels/:id/state", async (c) => {
    const channelId = c.req.param("id")!;
    const userId = c.get("botUser").id;
    const channel = requireGuildMember(repos, channelId, userId);
    if (!channel) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    const body = await parseJsonBody<{ key: string; value: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    let err = validateString(body.key, "key", { required: true });
    if (err) return validationError(c, err);
    err = validateString(body.value, "value", { required: true });
    if (err) return validationError(c, err);

    const entry = repos.state.upsert(channelId, body.key, body.value);

    dispatcher?.stateUpdate(entry);

    return c.json(entry);
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

    const body = await parseJsonBody<{ name: string; icon?: string; topic?: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.name, "name", { required: true, maxLength: 100 });
    if (err) return validationError(c, err);

    const name = body.name.trim();

    const channel = repos.channels.create(guildId, name, body.icon, body.topic);
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
      icon?: string;
      cove_position?: { x: number; y: number };
    }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const errors: string[] = [];
    let err = validateString(body.name, "name", { maxLength: 100 });
    if (err) errors.push(err);
    err = validateString(body.topic, "topic", { maxLength: 1024 });
    if (err) errors.push(err);
    if (body.cove_position !== undefined) {
      err = validateFiniteNumber(body.cove_position?.x, "cove_position.x");
      if (err) errors.push(err);
      err = validateFiniteNumber(body.cove_position?.y, "cove_position.y");
      if (err) errors.push(err);
    }
    if (errors.length > 0) return validationError(c, errors[0]);

    const { name, topic, icon, cove_position } = body;
    if (name === undefined && topic === undefined && icon === undefined && cove_position === undefined) {
      return c.json(channel);
    }

    const updated = repos.channels.update(id, body)!;

    dispatcher?.channelUpdate(updated);

    return c.json(updated);
  });

  app.delete("/api/v10/channels/:id/state/:key", (c) => {
    const channelId = c.req.param("id")!;
    const key = c.req.param("key")!;
    const userId = c.get("botUser").id;
    const ch = requireGuildMember(repos, channelId, userId);
    if (!ch) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }

    if (!repos.state.delete(channelId, key)) {
      return c.json({ message: "State key not found" }, 404);
    }

    dispatcher?.stateDelete(channelId, key);

    return c.body(null, 204);
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
