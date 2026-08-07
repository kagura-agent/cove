import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Repos } from "../repos/index.js";
import type { Channel, Guild } from "@cove/shared";
import { computeBasePermissions, computePermissions } from "../permissions/compute.js";

/**
 * Load a channel and verify the user is a member of its guild.
 * Returns the channel if the user is a member, null otherwise.
 * Used to enforce guild membership on direct channel routes.
 */
export function requireGuildMember(
  repos: Repos,
  channelId: string,
  userId: string,
): Channel | null {
  const channel = repos.channels.getById(channelId);
  if (!channel) return null;
  if (!repos.members.exists(channel.guild_id, userId)) return null;
  return channel;
}

export function unknownGuild(c: Context) {
  return c.json({ message: "Unknown Guild", code: 10004 }, 404);
}

export function unknownChannel(c: Context) {
  return c.json({ message: "Unknown Channel", code: 10003 }, 404);
}

export function unknownMessage(c: Context) {
  return c.json({ message: "Unknown Message", code: 10008 }, 404);
}

export function requireBotChannelPermission(
  repos: Repos,
  channelId: string,
  userId: string,
  isBotUser: boolean,
): boolean {
  if (!isBotUser) return true;
  const VIEW_CHANNEL = 1n << 10n;
  if (repos.permissions.hasPermission(channelId, userId, VIEW_CHANNEL)) {
    return true;
  }
  // Thread channels (type 11) don't have their own permission overwrites;
  // inherit from the parent channel.
  const channel = repos.channels.getById(channelId);
  if (channel && channel.type === 11 && channel.parent_id) {
    return repos.permissions.hasPermission(channel.parent_id, userId, VIEW_CHANNEL);
  }
  return false;
}

function missingPermissions(): HTTPException {
  const res = new Response(JSON.stringify({ message: "Missing Permissions", code: 50013 }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
  return new HTTPException(403, { res });
}

function unknownChannelException(): HTTPException {
  const res = new Response(JSON.stringify({ message: "Unknown Channel", code: 10003 }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
  return new HTTPException(404, { res });
}

function unknownGuildException(): HTTPException {
  const res = new Response(JSON.stringify({ message: "Unknown Guild", code: 10004 }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
  return new HTTPException(404, { res });
}

/**
 * Check channel-scoped permissions. Resolves channel -> guild -> member -> roles -> overwrites.
 * For thread channels (type 11), uses the parent channel's overwrites.
 * Throws 404 if channel/guild not found or user is not a member.
 * Throws 403 if the user lacks the required permission bits.
 */
export async function requireChannelPermission(
  repos: Repos,
  channelId: string,
  userId: string,
  permission: bigint,
): Promise<Channel> {
  const channel = repos.channels.getById(channelId);
  if (!channel) throw unknownChannelException();

  const guild = repos.guilds.getById(channel.guild_id);
  if (!guild) throw unknownChannelException();

  const member = repos.members.get(channel.guild_id, userId);
  if (!member) throw unknownChannelException();

  const roles = repos.roles.listByGuild(channel.guild_id);

  // For threads (type 11), use parent channel's overwrites
  const overwriteChannelId = channel.type === 11 && channel.parent_id ? channel.parent_id : channelId;
  const overwrites = repos.permissions.listByChannel(overwriteChannelId);

  const perms = computePermissions(member, channel, guild, roles, overwrites);
  if ((perms & permission) !== permission) {
    throw missingPermissions();
  }

  return channel;
}

/**
 * Check guild-scoped permissions (no channel context, base permissions only).
 * Throws 403 if the user lacks the required permission bits.
 */
export async function requireGuildPermission(
  repos: Repos,
  guildId: string,
  userId: string,
  permission: bigint,
): Promise<Guild> {
  const guild = repos.guilds.getById(guildId);
  if (!guild) throw unknownGuildException();

  const member = repos.members.get(guildId, userId);
  if (!member) throw unknownGuildException();

  const roles = repos.roles.listByGuild(guildId);

  const perms = computeBasePermissions(member, guild, roles);
  if ((perms & permission) !== permission) {
    throw missingPermissions();
  }

  return guild;
}
