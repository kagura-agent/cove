import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { AppEnv } from "../auth.js";
import { parseJsonBody, validationError } from "../validation.js";
import { requireChannelPermission, unknownChannel } from "./helpers.js";
import { PermissionBits } from "@cove/shared";
import { computePermissions } from "../permissions/compute.js";

/** Guild-level bits that cannot appear in channel permission overwrites. */
const GUILD_ONLY_BITS =
  PermissionBits.ADMINISTRATOR |
  PermissionBits.KICK_MEMBERS |
  PermissionBits.BAN_MEMBERS |
  PermissionBits.MANAGE_GUILD |
  PermissionBits.VIEW_AUDIT_LOG |
  PermissionBits.MANAGE_NICKNAMES;

export function permissionRoutes(repos: Repos): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.put("/channels/:channelId/permissions/:targetId", async (c) => {
    const user = c.get("botUser");
    const channelId = c.req.param("channelId")!;
    const targetId = c.req.param("targetId")!;
    const channel = await requireChannelPermission(repos, channelId, user.id, PermissionBits.MANAGE_ROLES);

    const body = await parseJsonBody<{ type: number; allow: string; deny: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    if (body.type !== 0 && body.type !== 1) {
      return validationError(c, "type must be 0 (role) or 1 (member)");
    }
    if (typeof body.allow !== "string" || typeof body.deny !== "string") {
      return validationError(c, "allow and deny must be strings");
    }

    let allow: bigint;
    let deny: bigint;
    try {
      allow = BigInt(body.allow);
      deny = BigInt(body.deny);
    } catch {
      return validationError(c, "allow and deny must be valid integer strings");
    }

    // Guild-level bits cannot appear in channel overwrites
    if ((allow | deny) & GUILD_ONLY_BITS) {
      return c.json({ message: "Guild-level permission bits cannot be used in channel overwrites", code: 50013 }, 400);
    }

    // Overwrite values must be a subset of the caller's computed permissions
    const member = repos.members.get(channel.guild_id, user.id)!;
    const guild = repos.guilds.getById(channel.guild_id)!;
    const roles = repos.roles.listByGuild(channel.guild_id);
    const overwriteChannelId = channel.type === 11 && channel.parent_id ? channel.parent_id : channelId;
    const overwrites = repos.permissions.listByChannel(overwriteChannelId);
    const callerPerms = computePermissions(member, channel, guild, roles, overwrites);

    if ((allow & ~callerPerms) !== 0n || (deny & ~callerPerms) !== 0n) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    repos.permissions.upsert(channelId, targetId, body.type, body.allow, body.deny);
    return c.body(null, 204);
  });

  app.delete("/channels/:channelId/permissions/:targetId", async (c) => {
    const user = c.get("botUser");
    const channelId = c.req.param("channelId")!;
    const targetId = c.req.param("targetId")!;
    await requireChannelPermission(repos, channelId, user.id, PermissionBits.MANAGE_ROLES);

    repos.permissions.remove(channelId, targetId);
    return c.body(null, 204);
  });

  return app;
}
