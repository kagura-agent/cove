import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { unknownGuild } from "./helpers.js";
import { generateSnowflake, PermissionBits, DEFAULT_EVERYONE_PERMISSIONS, ALL_PERMISSIONS, type Role, type Channel } from "@cove/shared";
import { computeBasePermissions } from "../permissions/compute.js";

const MAX_GUILDS_PER_USER = 10;

export function guildRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // POST /guilds — Create a new guild
  app.post("/guilds", async (c) => {
    const userId = c.get("botUser").id;

    const body = await parseJsonBody<{ name: string }>(c);
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

    // Wrap all DB writes in a transaction to avoid partial state on failure
    const { guild, everyoneRole, generalChannel } = repos.db.transaction(() => {
      const guild = repos.guilds.create({ id: guildId, name, owner_id: userId });
      const everyoneRole = repos.roles.createEveryoneRole(guildId, DEFAULT_EVERYONE_PERMISSIONS.toString());
      const generalChannel = repos.channels.create(guildId, "general", undefined, 0);
      repos.members.add(guildId, userId);
      return { guild, everyoneRole, generalChannel };
    })() as { guild: ReturnType<typeof repos.guilds.create>; everyoneRole: Role; generalChannel: Channel };

    // Dispatch GUILD_CREATE with full payload (channels + roles) to the creating user
    dispatcher?.guildCreateFull(userId, guildId, {
      ...guild,
      features: [],
      channels: [generalChannel],
      roles: [everyoneRole],
    });

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

    const body = await parseJsonBody<{ name?: string }>(c);
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

    const updated = repos.guilds.update(guildId, { name: body.name });
    if (!updated) return unknownGuild(c);

    // Dispatch GUILD_UPDATE to all guild members
    dispatcher?.guildUpdate(guildId, updated);

    return c.json(updated);
  });

  // POST /guilds/:guildId/invite-agent — Create a bot user and invite them to the guild
  app.post("/guilds/:guildId/invite-agent", async (c) => {
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

    const body = await parseJsonBody<{ agentName: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.agentName, "agentName", { required: true, maxLength: 80 });
    if (err) return validationError(c, err);

    const agentName = body.agentName.trim();
    const agentId = agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    // Check if bot user already exists
    if (repos.users.exists(agentId)) {
      return c.json({ message: `Agent '${agentName}' already exists. Choose a different name.` }, 409);
    }

    // Create bot user (auto-joins the specified guild)
    const botUser = repos.users.create({ username: agentName, bot: true }, guildId);

    // Create an ADMINISTRATOR role for the bot
    const adminRole = repos.roles.create(guildId, {
      name: "Server Admin",
      permissions: ALL_PERMISSIONS.toString(),
    });

    // Assign the admin role to the bot member
    repos.db
      .prepare("UPDATE guild_members SET roles = ? WHERE guild_id = ? AND user_id = ?")
      .run(JSON.stringify([adminRole.id]), guildId, botUser.id);

    // Dispatch GUILD_MEMBER_ADD to notify guild members
    dispatcher?.guildMemberAdd(guildId, {
      user: { id: botUser.id },
      nick: null,
      roles: [adminRole.id],
      joined_at: new Date().toISOString(),
    });

    // Derive baseUrl from request
    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    const inviteLetter = [
      `📮 Invitation to ${agentName}`,
      ``,
      `You've been invited to join "${guild.name}" as Server Admin.`,
      ``,
      `A private cove awaits — with channels to explore,`,
      `routines to build, and a human who chose you.`,
      ``,
      `🏝️ Server: ${guild.name}`,
      `👑 Role: Server Admin`,
      ``,
      `════════════════════════════════════════`,
      `To accept this invitation, follow these steps:`,
      ``,
      `# Step 1: Install the Cove plugin`,
      `npm pack openclaw-cove --registry https://registry.npmjs.org`,
      `openclaw plugins install ./openclaw-cove-*.tgz`,
      ``,
      `# Step 2: Configure your connection`,
      `openclaw config set channels.cove.token "${botUser.token}"`,
      `openclaw config set channels.cove.baseUrl "${baseUrl}"`,
      `openclaw config set channels.cove.guildId "${guildId}"`,
      `openclaw config set channels.cove.agentId "${agentId}"`,
      `openclaw config set channels.cove.agentName "${agentName}"`,
      `openclaw config set channels.cove.allowFrom '["*"]'`,
      ``,
      `# Step 3: Restart to connect`,
      `openclaw gateway restart`,
      ``,
      `════════════════════════════════════════`,
      `After restart, you'll be connected automatically.`,
      `Say hello in #general!`,
    ].join("\n");

    return c.json({
      agentName,
      token: botUser.token,
      baseUrl,
      guildId,
      agentId,
      inviteLetter,
    }, 201);
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
