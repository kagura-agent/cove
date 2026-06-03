import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { Repos } from "../repos/index.js";
import { DEFAULT_GUILD_ID } from "../repos/index.js";
import type { BroadcastFn } from "./messages.js";
import { requireBotAuth } from "../auth.js";

export function channelRoutes(db: Database.Database, repos: Repos, broadcast?: BroadcastFn): Hono {
  const app = new Hono();
  const auth = requireBotAuth(db);

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
    const body = await c.req.json<{ key: string; value: string }>();

    const entry = repos.state.upsert(channelId, body.key, body.value);

    if (broadcast) {
      broadcast({ op: 0, t: "STATE_UPDATE", d: entry, s: null });
    }

    return c.json(entry);
  });

  app.post("/api/v10/guilds/:guildId/channels", async (c) => {
    const guildId = c.req.param("guildId");
    if (guildId !== DEFAULT_GUILD_ID) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    const body = await c.req.json<{ name: string; icon?: string; topic?: string }>();
    const name = body.name?.trim();
    if (!name) {
      return c.json({ message: "Name is required" }, 400);
    }

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

    const body = await c.req.json<{
      name?: string;
      topic?: string;
      icon?: string;
      cove_position?: { x: number; y: number };
    }>();

    const { name, topic, icon, cove_position } = body;
    if (name === undefined && topic === undefined && icon === undefined && cove_position === undefined) {
      return c.json(repos.channels.getById(id));
    }

    const channel = repos.channels.update(id, body)!;

    if (broadcast) {
      broadcast({ op: 0, t: "CHANNEL_UPDATE", d: channel, s: null });
    }

    return c.json(channel);
  });

  app.delete("/api/v10/channels/:id/state/:key", (c) => {
    const channelId = c.req.param("id");
    const key = c.req.param("key");

    if (!repos.state.delete(channelId, key)) {
      return c.json({ message: "State key not found" }, 404);
    }

    if (broadcast) {
      broadcast({ op: 0, t: "STATE_DELETE", d: { channel_id: channelId, key }, s: null });
    }

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
