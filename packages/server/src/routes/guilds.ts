import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { unknownGuild } from "./helpers.js";
import { generateSnowflake, PermissionBits, DEFAULT_EVERYONE_PERMISSIONS } from "@cove/shared";
import { computeBasePermissions } from "../permissions/compute.js";

const MAX_GUILDS_PER_USER = 10;

export function guildRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // POST /guilds — Create a new guild
  app.post("/guilds", async (c) => {
    const userId = c.get("botUser").id;

    const body = await parseJsonBody<{ name: string; icon?: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.name, "name", { required: true, maxLength: 100 });
    if (err) return validationError(c, err);

    const name = body.name.trim();
    if (name.length < 2) {
      return validationError(c, "name must be between 2 and 100 characters");
    }

    // Rate limit: max 10 guilds per user
    const guildCount = repos.guilds.countByOwner(userId);
    if (guildCount >= MAX_GUILDS_PER_USER) {
      return c.json({ message: "Maximum number of guilds reached" }, 403);
    }

    const guildId = generateSnowflake();

    // Create guild
    const guild = repos.guilds.create({ id: guildId, name, icon: body.icon, owner_id: userId });

    // Create @everyone role (id = guild id, position 0)
    const everyoneRole = repos.roles.createEveryoneRole(guildId, DEFAULT_EVERYONE_PERMISSIONS.toString());

    // Create #general text channel (position 0)
    const generalChannel = repos.channels.create(guildId, "general", undefined, 0);

    // Add creator as first guild member
    repos.members.add(guildId, userId);

    // Dispatch GUILD_CREATE to the creating user
    dispatcher?.addGuildToUser(userId, guildId);

    return c.json({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      owner_id: guild.owner_id,
      roles: [everyoneRole],
      channels: [generalChannel],
    }, 201);
  });

  // PATCH /guilds/:guildId — Update guild
  app.patch("/guilds/:guildId", async (c) => {
    const guildId = c.req.param("guildId")!;
    const userId = c.get("botUser").id;

    const guild = repos.guilds.getById(guildId);
    if (!guild) return unknownGuild(c);

    const member = repos.members.get(guildId, userId);
    if (!member) return unknownGuild(c);

    // Authorization: owner OR MANAGE_GUILD permission
    const isOwner = guild.owner_id !== null && guild.owner_id === userId;

    if (!isOwner) {
      const roles = repos.roles.listByGuild(guildId);
      const perms = computeBasePermissions(member, guild, roles);
      if ((perms & PermissionBits.MANAGE_GUILD) === 0n) {
        return c.json({ message: "Missing Permissions", code: 50013 }, 403);
      }
    }

    const body = await parseJsonBody<{ name?: string; icon?: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    if (body.name !== undefined) {
      const err = validateString(body.name, "name", { maxLength: 100 });
      if (err) return validationError(c, err);
      const trimmed = body.name.trim();
      if (trimmed.length < 2) {
        return validationError(c, "name must be between 2 and 100 characters");
      }
      body.name = trimmed;
    }

    const updated = repos.guilds.update(guildId, body);
    if (!updated) return unknownGuild(c);

    // Dispatch GUILD_UPDATE to all guild members
    dispatcher?.guildUpdate(guildId, updated);

    return c.json(updated);
  });

  // DELETE /guilds/:guildId — Delete guild
  app.delete("/guilds/:guildId", async (c) => {
    const guildId = c.req.param("guildId")!;
    const userId = c.get("botUser").id;

    const guild = repos.guilds.getById(guildId);
    if (!guild) return unknownGuild(c);

    // Seed guild (owner_id NULL) cannot be deleted
    if (guild.owner_id === null) {
      return c.json({ message: "Cannot delete the seed guild" }, 403);
    }

    // Only owner can delete
    if (guild.owner_id !== userId) {
      return c.json({ message: "Missing Permissions" }, 403);
    }

    // Get all member user IDs before deletion for gateway notification
    const members = repos.members.list(guildId);
    const memberUserIds = members.map((m) => m.user.id);

    // Cascade delete all guild data
    repos.guilds.delete(guildId);

    // Dispatch GUILD_DELETE to all former members
    dispatcher?.guildDelete(guildId, memberUserIds);

    return c.body(null, 204);
  });

  return app;
}
