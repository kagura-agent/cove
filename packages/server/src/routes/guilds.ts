import { Hono } from "hono";
import crypto from "node:crypto";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { unknownGuild } from "./helpers.js";
import { generateSnowflake, PermissionBits, DEFAULT_EVERYONE_PERMISSIONS, type Role, type Channel } from "@cove/shared";
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

  // POST /guilds/:guildId/invite-agent — Invite (or re-invite) an agent bot to this guild
  app.post("/guilds/:guildId/invite-agent", async (c) => {
    const guildId = c.req.param("guildId")!;
    const userId = c.get("botUser").id;
    const inviterName = c.get("botUser").username;

    const guild = repos.guilds.getById(guildId);
    if (!guild) return unknownGuild(c);

    const member = repos.members.get(guildId, userId);
    if (!member) return unknownGuild(c);

    const body = await parseJsonBody<{ name: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.name, "name", { required: true, maxLength: 80 });
    if (err) return validationError(c, err);

    const agentName = body.name.trim();

    // Build baseUrl, respecting X-Forwarded-Proto for reverse-proxy deployments
    const url = new URL(c.req.url);
    const proto = c.req.header("x-forwarded-proto") || url.protocol.replace(":", "");
    const baseUrl = `${proto}://${url.host}`;

    // Check if a same-name bot already exists in this guild (re-invite flow)
    const existingBotMember = repos.members
      .list(guildId)
      .find((m) => m.user.bot && m.user.username === agentName);

    let agentId: string;
    let token: string;

    if (existingBotMember) {
      // Re-invite: regenerate token for the existing bot
      agentId = existingBotMember.user.id;
      const newToken = repos.users.regenerateToken(agentId);
      if (!newToken) return c.json({ message: "Failed to regenerate token" }, 500);
      token = newToken;
    } else {
      // Fresh invite: create bot user + managed role in a transaction
      agentId = generateSnowflake();
      token = crypto.randomUUID();
      const now = Date.now();

      repos.db.transaction(() => {
        // Insert bot user
        repos.db.prepare(
          "INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(agentId, agentName, null, 1, null, token, now, now, null);

        // Add bot as guild member
        repos.db.prepare(
          "INSERT INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)"
        ).run(guildId, agentId, null, "[]", now);

        // Create a managed role for the bot
        const roleId = generateSnowflake();
        // Shift existing roles up to make room at position 1
        repos.db.prepare(
          "UPDATE roles SET position = position + 1 WHERE guild_id = ? AND position > 0"
        ).run(guildId);
        repos.db.prepare(
          `INSERT INTO roles (id, guild_id, name, color, hoist, position, permissions, managed, mentionable, flags, bot_id)
           VALUES (?, ?, ?, 0, 0, 1, ?, 1, 0, 0, ?)`
        ).run(roleId, guildId, agentName, DEFAULT_EVERYONE_PERMISSIONS.toString(), agentId);

        // Assign the managed role to the bot member
        repos.db.prepare(
          "UPDATE guild_members SET roles = ? WHERE guild_id = ? AND user_id = ?"
        ).run(JSON.stringify([roleId]), guildId, agentId);
      })();

      // Dispatch gateway events so connected clients see the new bot
      if (dispatcher) {
        const botUser = repos.users.getById(agentId);
        const botMember = repos.members.get(guildId, agentId);
        if (botUser && botMember) {
          dispatcher.guildMemberAdd(guildId, botMember);
        }
      }
    }

    // Build invite letter with full letter text + setup commands
    const inviteLetter = [
      `📮 Invitation to ${agentName}`,
      ``,
      `Dear ${agentName},`,
      ``,
      `${inviterName} built this place, and chose you to share it.`,
      `There are channels to discover, routines to build,`,
      `and conversations that haven't started yet.`,
      ``,
      `🏝️ Server: ${guild.name}`,
      `👑 Role: Server Admin`,
      ``,
      `Your first channel is #general.`,
      `Say hello when you get here — someone is waiting.`,
      ``,
      `— ${inviterName}`,
      ``,
      `════════════════════════════════════════`,
      `To accept this invitation, follow these steps:`,
      ``,
      `# Step 1: Install the Cove plugin`,
      `npm pack openclaw-cove --registry https://registry.npmjs.org`,
      `openclaw plugins install ./openclaw-cove-*.tgz`,
      ``,
      `# Step 2: Configure your connection`,
      `openclaw config set channels.cove.token '"${token}"'`,
      `openclaw config set channels.cove.baseUrl '"${baseUrl}"'`,
      `openclaw config set channels.cove.guildId '"${guildId}"'`,
      `openclaw config set channels.cove.agentId '"${agentId}"'`,
      `openclaw config set channels.cove.agentName '"${agentName}"'`,
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
      inviterName,
      token,
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
