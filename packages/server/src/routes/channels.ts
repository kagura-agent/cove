import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import { DEFAULT_GUILD_ID } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import { requireAuth, type AppEnv } from "../auth.js";
import { validateString, validateFiniteNumber, validationError, parseJsonBody } from "../validation.js";

export function channelRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(repos.users);

  app.get("/api/v10/guilds/:guildId/channels", (c) => {
    const guildId = c.req.param("guildId");
    if (guildId !== DEFAULT_GUILD_ID) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }
    return c.json(repos.channels.list(guildId));
  });

  app.get("/api/v10/channels/:id", (c) => {
    const id = c.req.param("id");
    const channel = repos.channels.getById(id);
    if (!channel) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }
    return c.json(channel);
  });

  app.get("/api/v10/channels/:id/state", (c) => {
    const channelId = c.req.param("id");
    return c.json(repos.state.list(channelId));
  });

  app.put("/api/v10/channels/:id/state", async (c) => {
    const channelId = c.req.param("id");
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

  app.post("/api/v10/guilds/:guildId/channels", async (c) => {
    const guildId = c.req.param("guildId");
    if (guildId !== DEFAULT_GUILD_ID) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    const body = await parseJsonBody<{ name: string; icon?: string; topic?: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.name, "name", { required: true, maxLength: 100 });
    if (err) return validationError(c, err);

    const name = body.name.trim();

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (repos.channels.exists(id)) {
      return c.json({ message: "Channel already exists", code: 10013 }, 409);
    }

    const channel = repos.channels.create(name, body.icon, body.topic);
    return c.json(channel, 201);
  });

  app.patch("/api/v10/channels/:id", async (c) => {
    const id = c.req.param("id");
    if (!repos.channels.exists(id)) {
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
      return c.json(repos.channels.getById(id));
    }

    const channel = repos.channels.update(id, body)!;

    dispatcher?.channelUpdate(channel);

    return c.json(channel);
  });

  app.delete("/api/v10/channels/:id/state/:key", (c) => {
    const channelId = c.req.param("id");
    const key = c.req.param("key");

    if (!repos.state.delete(channelId, key)) {
      return c.json({ message: "State key not found" }, 404);
    }

    dispatcher?.stateDelete(channelId, key);

    return c.body(null, 204);
  });

  app.delete("/api/v10/channels/:id", auth, (c) => {
    const id = c.req.param("id");
    if (!repos.channels.delete(id!)) {
      return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    }
    return c.json({ deleted: true });
  });

  return app;
}
