import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validateFiniteNumber, validationError, parseJsonBody } from "../validation.js";
import { requireGuildMember, requireBotChannelPermission, unknownGuild, unknownChannel } from "./helpers.js";

export function channelRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/guilds/:guildId/channels", (c) => {
    const guildId = c.req.param("guildId")!;
    if (!repos.guilds.exists(guildId)) {
      return unknownGuild(c);
    }
    const user = c.get("botUser");
    if (!repos.members.exists(guildId, user.id)) {
      return unknownGuild(c);
    }
    let channels = repos.channels.list(guildId);
    if (user.bot) {
      channels = channels.filter((ch) =>
        requireBotChannelPermission(repos, ch.id, user.id, true),
      );
    }
    return c.json(channels);
  });

  app.get("/channels/:id", (c) => {
    const id = c.req.param("id")!;
    const user = c.get("botUser");
    const channel = requireGuildMember(repos, id, user.id);
    if (!channel) {
      return unknownChannel(c);
    }
    if (!requireBotChannelPermission(repos, id, user.id, user.bot)) {
      return c.json({ message: "Missing Access", code: 50001 }, 403);
    }
    return c.json(channel);
  });

  app.post("/guilds/:guildId/channels", async (c) => {
    const guildId = c.req.param("guildId")!;
    if (!repos.guilds.exists(guildId)) {
      return unknownGuild(c);
    }
    const userId = c.get("botUser").id;
    if (!repos.members.exists(guildId, userId)) {
      return unknownGuild(c);
    }

    const body = await parseJsonBody<{ name: string; topic?: string; type?: number }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.name, "name", { required: true, maxLength: 100 });
    if (err) return validationError(c, err);

    const topicErr = validateString(body.topic, "topic", { maxLength: 1024 });
    if (topicErr) return validationError(c, topicErr);

    if (body.type !== undefined) {
      const typeErr = validateFiniteNumber(body.type, "type");
      if (typeErr || !Number.isInteger(body.type) || ![0, 2, 4, 5, 13].includes(body.type as number)) {
        return validationError(c, "type must be one of 0, 2, 4, 5, 13");
      }
    }

    const name = body.name.trim();

    const channel = repos.channels.create(guildId, name, body.topic, body.type ?? 0);

    dispatcher?.channelCreate(channel);

    return c.json(channel, 201);
  });

  app.patch("/channels/:id", async (c) => {
    const id = c.req.param("id")!;
    const user = c.get("botUser");
    const channel = requireGuildMember(repos, id, user.id);
    if (!channel) {
      return unknownChannel(c);
    }
    if (!requireBotChannelPermission(repos, id, user.id, user.bot)) {
      return c.json({ message: "Missing Access", code: 50001 }, 403);
    }

    const body = await parseJsonBody<{
      name?: string;
      topic?: string;
      position?: number;
      type?: number;
      archived?: boolean;
      locked?: boolean;
    }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const errors: string[] = [];
    let err = validateString(body.name, "name", { maxLength: 100 });
    if (err) errors.push(err);
    err = validateString(body.topic, "topic", { maxLength: 1024 });
    if (err) errors.push(err);
    if (body.position !== undefined) {
      const posErr = validateFiniteNumber(body.position, "position");
      if (posErr || !Number.isInteger(body.position) || body.position < 0) {
        errors.push("position must be a non-negative integer");
      }
    }
    if (body.type !== undefined) {
      const typeErr = validateFiniteNumber(body.type, "type");
      if (typeErr || !Number.isInteger(body.type) || ![0, 2, 4, 5, 13].includes(body.type as number)) {
        errors.push("type must be one of 0, 2, 4, 5, 13");
      }
    }
    if (errors.length > 0) return validationError(c, errors[0]);

    const { name, topic, position, type } = body;

    // Handle thread-specific fields (archived/locked) for type=11 channels
    if (channel.type === 11) {
      let threadUpdated: import("@cove/shared").Channel | null = null;
      if (body.archived !== undefined) {
        threadUpdated = repos.threads.setArchived(id, body.archived);
      }
      if (body.locked !== undefined) {
        threadUpdated = repos.threads.setLocked(id, body.locked);
      }
      if (threadUpdated) {
        // Also apply name/topic updates if present
        if (name !== undefined || topic !== undefined || position !== undefined) {
          const finalUpdated = repos.channels.update(id, { name, topic, position })!;
          dispatcher?.threadUpdate(finalUpdated);
          return c.json(finalUpdated);
        }
        dispatcher?.threadUpdate(threadUpdated);
        return c.json(threadUpdated);
      }
    }

    if (name === undefined && topic === undefined && position === undefined && type === undefined) {
      return c.json(channel);
    }

    const updated = repos.channels.update(id, body)!;

    dispatcher?.channelUpdate(updated);

    return c.json(updated);
  });

  app.delete("/channels/:id", (c) => {
    const id = c.req.param("id")!;
    const user = c.get("botUser");
    const ch = requireGuildMember(repos, id, user.id);
    if (!ch) {
      return unknownChannel(c);
    }
    if (!requireBotChannelPermission(repos, id, user.id, user.bot)) {
      return c.json({ message: "Missing Access", code: 50001 }, 403);
    }
    if (!repos.channels.delete(id)) {
      return unknownChannel(c);
    }

    dispatcher?.channelDelete(ch.guild_id, id);
    if (ch.type === 11) {
      dispatcher?.threadDelete(ch);
    }

    return c.json(ch);
  });

  return app;
}
