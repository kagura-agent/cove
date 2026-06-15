import type { Context } from "hono";
import type { Repos } from "../repos/index.js";
import type { Channel } from "@cove/shared";

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
