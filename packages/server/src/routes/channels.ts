import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validateFiniteNumber, validationError, parseJsonBody } from "../validation.js";
import { requireChannelPermission, requireGuildPermission, unknownGuild, unknownChannel } from "./helpers.js";
import { PermissionBits } from "@cove/shared";
import { computePermissions } from "../permissions/compute.js";

export function channelRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/guilds/:guildId/channels", (c) => {
    const guildId = c.req.param("guildId")!;
    const guild = repos.guilds.getById(guildId);
    if (!guild) {
      return unknownGuild(c);
    }
    const user = c.get("botUser");
    const member = repos.members.get(guildId, user.id);
    if (!member) {
      return unknownGuild(c);
    }
    const roles = repos.roles.listByGuild(guildId);
    const channels = repos.channels.list(guildId).filter((ch) => {
      const overwriteChannelId = ch.type === 11 && ch.parent_id ? ch.parent_id : ch.id;
      const overwrites = repos.permissions.listByChannel(overwriteChannelId);
      const perms = computePermissions(member, ch, guild, roles, overwrites);
      return (perms & PermissionBits.VIEW_CHANNEL) !== 0n;
    });
    return c.json(channels);
  });

  app.get("/channels/:id", async (c) => {
    const id = c.req.param("id")!;
    const user = c.get("botUser");
    const channel = await requireChannelPermission(repos, id, user.id, PermissionBits.VIEW_CHANNEL);
    return c.json(channel);
  });

  app.post("/guilds/:guildId/channels", async (c) => {
    const guildId = c.req.param("guildId")!;
    const userId = c.get("botUser").id;
    await requireGuildPermission(repos, guildId, userId, PermissionBits.MANAGE_CHANNELS);

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
    const channel = await requireChannelPermission(repos, id, user.id, PermissionBits.MANAGE_CHANNELS);

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
    if (channel.type === 11 && (body.archived !== undefined || body.locked !== undefined)) {
      // Only thread owner can archive/lock
      if (channel.owner_id && channel.owner_id !== user.id) {
        return c.json({ message: 'Missing Permissions', code: 50013 }, 403);
      }
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

  app.delete("/channels/:id", async (c) => {
    const id = c.req.param("id")!;
    const user = c.get("botUser");
    const ch = await requireChannelPermission(repos, id, user.id, PermissionBits.MANAGE_CHANNELS);
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
