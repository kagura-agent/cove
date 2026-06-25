import { Hono } from "hono";
import type { Context } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import type { Role } from "@cove/shared";
import { PermissionBits } from "@cove/shared";
import { computeBasePermissions } from "../permissions/compute.js";
import { parseJsonBody, validationError } from "../validation.js";
import { unknownGuild } from "./helpers.js";

const MANAGE_ROLES = PermissionBits.MANAGE_ROLES;

function missingPermissions(c: Context) {
  return c.json({ message: "Missing Permissions", code: 50013 }, 403);
}

function unknownRole(c: Context) {
  return c.json({ message: "Unknown Role", code: 10011 }, 404);
}

/** Returns the highest position among the member's assigned roles. */
function getHighestPosition(memberRoles: string[], allRoles: Role[]): number {
  let max = 0; // @everyone is position 0
  for (const roleId of memberRoles) {
    const role = allRoles.find((r) => r.id === roleId);
    if (role && role.position > max) {
      max = role.position;
    }
  }
  return max;
}

export function roleRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // GET /guilds/:guildId/roles — list all roles (any guild member)
  app.get("/guilds/:guildId/roles", (c) => {
    const guildId = c.req.param("guildId")!;
    const user = c.get("botUser");

    if (!repos.guilds.exists(guildId)) return unknownGuild(c);
    if (!repos.members.exists(guildId, user.id)) return unknownGuild(c);

    const roles = repos.roles.listByGuild(guildId);
    return c.json(roles);
  });

  // GET /guilds/:guildId/roles/:roleId — get single role (any guild member)
  app.get("/guilds/:guildId/roles/:roleId", (c) => {
    const guildId = c.req.param("guildId")!;
    const roleId = c.req.param("roleId")!;
    const user = c.get("botUser");

    if (!repos.guilds.exists(guildId)) return unknownGuild(c);
    if (!repos.members.exists(guildId, user.id)) return unknownGuild(c);

    const role = repos.roles.getById(roleId, guildId);
    if (!role) return unknownRole(c);

    return c.json(role);
  });

  // POST /guilds/:guildId/roles — create role
  app.post("/guilds/:guildId/roles", async (c) => {
    const guildId = c.req.param("guildId")!;
    const user = c.get("botUser");

    const guild = repos.guilds.getById(guildId);
    if (!guild) return unknownGuild(c);

    const member = repos.members.get(guildId, user.id);
    if (!member) return missingPermissions(c);

    const roles = repos.roles.listByGuild(guildId);
    const callerPerms = computeBasePermissions(member, guild, roles);

    // Require MANAGE_ROLES
    if ((callerPerms & MANAGE_ROLES) === 0n) {
      return missingPermissions(c);
    }

    const body = await parseJsonBody<{
      name?: string;
      permissions?: string;
      color?: number;
      hoist?: boolean;
      mentionable?: boolean;
    }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    // Permission value constraint (§5.6): new permissions must be subset of caller's
    if (body.permissions !== undefined) {
      try {
        const newPerms = BigInt(body.permissions);
        if ((newPerms & ~callerPerms) !== 0n) {
          return missingPermissions(c);
        }
      } catch {
        return validationError(c, "permissions must be a valid integer string");
      }
    }

    const role = repos.roles.create(guildId, {
      name: body.name,
      permissions: body.permissions,
      color: body.color,
      hoist: body.hoist,
      mentionable: body.mentionable,
    });

    dispatcher?.guildRoleCreate(guildId, role);

    return c.json(role, 201);
  });

  // PATCH /guilds/:guildId/roles/:roleId — update role
  app.patch("/guilds/:guildId/roles/:roleId", async (c) => {
    const guildId = c.req.param("guildId")!;
    const roleId = c.req.param("roleId")!;
    const user = c.get("botUser");

    const guild = repos.guilds.getById(guildId);
    if (!guild) return unknownGuild(c);

    const member = repos.members.get(guildId, user.id);
    if (!member) return missingPermissions(c);

    const roles = repos.roles.listByGuild(guildId);
    const callerPerms = computeBasePermissions(member, guild, roles);

    // Require MANAGE_ROLES
    if ((callerPerms & MANAGE_ROLES) === 0n) {
      return missingPermissions(c);
    }

    const targetRole = repos.roles.getById(roleId, guildId);
    if (!targetRole) return unknownRole(c);

    // Cannot modify managed roles
    if (targetRole.managed) {
      return missingPermissions(c);
    }

    // Position constraint: target must be below caller's highest (owner exempt)
    if (guild.owner_id !== user.id) {
      const callerHighest = getHighestPosition(member.roles, roles);
      if (targetRole.position >= callerHighest) {
        return missingPermissions(c);
      }
    }

    const body = await parseJsonBody<{
      name?: string;
      permissions?: string;
      color?: number;
      hoist?: boolean;
      mentionable?: boolean;
    }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    // Permission value constraint (§5.6)
    if (body.permissions !== undefined) {
      try {
        const newPerms = BigInt(body.permissions);
        if ((newPerms & ~callerPerms) !== 0n) {
          return missingPermissions(c);
        }
      } catch {
        return validationError(c, "permissions must be a valid integer string");
      }
    }

    const updated = repos.roles.update(roleId, {
      name: body.name,
      permissions: body.permissions,
      color: body.color,
      hoist: body.hoist,
      mentionable: body.mentionable,
    });
    if (!updated) return unknownRole(c);

    dispatcher?.guildRoleUpdate(guildId, updated);

    return c.json(updated);
  });

  // DELETE /guilds/:guildId/roles/:roleId — delete role
  app.delete("/guilds/:guildId/roles/:roleId", (c) => {
    const guildId = c.req.param("guildId")!;
    const roleId = c.req.param("roleId")!;
    const user = c.get("botUser");

    const guild = repos.guilds.getById(guildId);
    if (!guild) return unknownGuild(c);

    const member = repos.members.get(guildId, user.id);
    if (!member) return missingPermissions(c);

    const roles = repos.roles.listByGuild(guildId);
    const callerPerms = computeBasePermissions(member, guild, roles);

    // Require MANAGE_ROLES
    if ((callerPerms & MANAGE_ROLES) === 0n) {
      return missingPermissions(c);
    }

    // Cannot delete @everyone role
    if (roleId === guildId) {
      return validationError(c, "Cannot delete the @everyone role");
    }

    const targetRole = repos.roles.getById(roleId, guildId);
    if (!targetRole) return unknownRole(c);

    // Cannot delete managed roles
    if (targetRole.managed) {
      return missingPermissions(c);
    }

    // Position constraint (owner exempt)
    if (guild.owner_id !== user.id) {
      const callerHighest = getHighestPosition(member.roles, roles);
      if (targetRole.position >= callerHighest) {
        return missingPermissions(c);
      }
    }

    repos.roles.delete(roleId);

    dispatcher?.guildRoleDelete(guildId, roleId);

    return c.body(null, 204);
  });

  // PATCH /guilds/:guildId/roles — bulk position update
  app.patch("/guilds/:guildId/roles", async (c) => {
    const guildId = c.req.param("guildId")!;
    const user = c.get("botUser");

    const guild = repos.guilds.getById(guildId);
    if (!guild) return unknownGuild(c);

    const member = repos.members.get(guildId, user.id);
    if (!member) return missingPermissions(c);

    const roles = repos.roles.listByGuild(guildId);
    const callerPerms = computeBasePermissions(member, guild, roles);

    // Require MANAGE_ROLES
    if ((callerPerms & MANAGE_ROLES) === 0n) {
      return missingPermissions(c);
    }

    const body = await parseJsonBody<Array<{ id: string; position: number }>>(c);
    if (!body || !Array.isArray(body)) {
      return validationError(c, "Body must be an array of { id, position } objects");
    }

    const callerHighest = guild.owner_id === user.id
      ? Infinity
      : getHighestPosition(member.roles, roles);

    for (const entry of body) {
      if (typeof entry.id !== "string" || typeof entry.position !== "number") {
        return validationError(c, "Each entry must have string id and number position");
      }
      // Cannot target @everyone (position 0)
      if (entry.id === guildId) {
        return validationError(c, "Cannot change position of @everyone role");
      }
      // Check CURRENT position: cannot move a role currently at or above caller's highest
      const targetRole = roles.find((r) => r.id === entry.id);
      if (targetRole && targetRole.position >= callerHighest) {
        return missingPermissions(c);
      }
      // Cannot move a role to or above caller's highest position
      if (entry.position >= callerHighest) {
        return missingPermissions(c);
      }
    }

    const updatedRoles = repos.roles.updatePositions(guildId, body);

    for (const role of updatedRoles) {
      dispatcher?.guildRoleUpdate(guildId, role);
    }

    return c.json(updatedRoles);
  });

  // PUT /guilds/:guildId/members/:userId/roles/:roleId — assign role
  app.put("/guilds/:guildId/members/:userId/roles/:roleId", (c) => {
    const guildId = c.req.param("guildId")!;
    const targetUserId = c.req.param("userId")!;
    const roleId = c.req.param("roleId")!;
    const user = c.get("botUser");

    const guild = repos.guilds.getById(guildId);
    if (!guild) return unknownGuild(c);

    const member = repos.members.get(guildId, user.id);
    if (!member) return missingPermissions(c);

    const roles = repos.roles.listByGuild(guildId);
    const callerPerms = computeBasePermissions(member, guild, roles);

    // Require MANAGE_ROLES
    if ((callerPerms & MANAGE_ROLES) === 0n) {
      return missingPermissions(c);
    }

    const targetRole = repos.roles.getById(roleId, guildId);
    if (!targetRole) return unknownRole(c);

    // Cannot assign managed roles
    if (targetRole.managed) {
      return missingPermissions(c);
    }

    // Position constraint (owner exempt)
    if (guild.owner_id !== user.id) {
      const callerHighest = getHighestPosition(member.roles, roles);
      if (targetRole.position >= callerHighest) {
        return missingPermissions(c);
      }
    }

    const targetMember = repos.members.get(guildId, targetUserId);
    if (!targetMember) {
      return c.json({ message: "Unknown Member", code: 10007 }, 404);
    }

    // Idempotent: if already has role, return 204 without event
    if (targetMember.roles.includes(roleId)) {
      return c.body(null, 204);
    }

    // Update guild_members.roles
    const newRoles = [...targetMember.roles, roleId];
    repos.db
      .prepare("UPDATE guild_members SET roles = ? WHERE guild_id = ? AND user_id = ?")
      .run(JSON.stringify(newRoles), guildId, targetUserId);

    dispatcher?.guildMemberUpdate(guildId, {
      user: targetMember.user,
      nick: targetMember.nick,
      roles: newRoles,
      joined_at: targetMember.joined_at,
    });

    return c.body(null, 204);
  });

  // DELETE /guilds/:guildId/members/:userId/roles/:roleId — remove role
  app.delete("/guilds/:guildId/members/:userId/roles/:roleId", (c) => {
    const guildId = c.req.param("guildId")!;
    const targetUserId = c.req.param("userId")!;
    const roleId = c.req.param("roleId")!;
    const user = c.get("botUser");

    const guild = repos.guilds.getById(guildId);
    if (!guild) return unknownGuild(c);

    const member = repos.members.get(guildId, user.id);
    if (!member) return missingPermissions(c);

    const roles = repos.roles.listByGuild(guildId);
    const callerPerms = computeBasePermissions(member, guild, roles);

    // Require MANAGE_ROLES
    if ((callerPerms & MANAGE_ROLES) === 0n) {
      return missingPermissions(c);
    }

    const targetRole = repos.roles.getById(roleId, guildId);
    if (!targetRole) return unknownRole(c);

    // Cannot remove managed roles
    if (targetRole.managed) {
      return missingPermissions(c);
    }

    // Position constraint (owner exempt)
    if (guild.owner_id !== user.id) {
      const callerHighest = getHighestPosition(member.roles, roles);
      if (targetRole.position >= callerHighest) {
        return missingPermissions(c);
      }
    }

    const targetMember = repos.members.get(guildId, targetUserId);
    if (!targetMember) {
      return c.json({ message: "Unknown Member", code: 10007 }, 404);
    }

    // Idempotent: if doesn't have role, return 204 without event
    if (!targetMember.roles.includes(roleId)) {
      return c.body(null, 204);
    }

    // Update guild_members.roles
    const newRoles = targetMember.roles.filter((r) => r !== roleId);
    repos.db
      .prepare("UPDATE guild_members SET roles = ? WHERE guild_id = ? AND user_id = ?")
      .run(JSON.stringify(newRoles), guildId, targetUserId);

    dispatcher?.guildMemberUpdate(guildId, {
      user: targetMember.user,
      nick: targetMember.nick,
      roles: newRoles,
      joined_at: targetMember.joined_at,
    });

    return c.body(null, 204);
  });

  return app;
}
