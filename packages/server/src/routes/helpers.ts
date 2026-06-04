import type { Repos } from '../repos/index.js';
import type { Channel } from '@cove/shared';

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
