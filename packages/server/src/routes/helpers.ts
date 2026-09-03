import type { Channel, Guild } from "@cove/shared";
import type { Repos } from "../repos/index.js";
import { computeBasePermissions, computePermissions } from "../permissions/compute.js";
import { errorDefinitions, errorException } from "./errors.js";

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
  if (!channel) throw errorException(errorDefinitions.unknownChannel);

  const guild = repos.guilds.getById(channel.guild_id);
  if (!guild) throw errorException(errorDefinitions.unknownChannel);

  const member = repos.members.get(channel.guild_id, userId);
  if (!member) throw errorException(errorDefinitions.unknownChannel);

  const roles = repos.roles.listByGuild(channel.guild_id);

  // For threads (type 11), use parent channel's overwrites
  const overwriteChannelId = channel.type === 11 && channel.parent_id ? channel.parent_id : channelId;
  const overwrites = repos.permissions.listByChannel(overwriteChannelId);

  const perms = computePermissions(member, channel, guild, roles, overwrites);
  if ((perms & permission) !== permission) {
    throw errorException(errorDefinitions.missingPermissions);
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
  if (!guild) throw errorException(errorDefinitions.unknownGuild);

  const member = repos.members.get(guildId, userId);
  if (!member) throw errorException(errorDefinitions.unknownGuild);

  const roles = repos.roles.listByGuild(guildId);

  const perms = computeBasePermissions(member, guild, roles);
  if ((perms & permission) !== permission) {
    throw errorException(errorDefinitions.missingPermissions);
  }

  return guild;
}
