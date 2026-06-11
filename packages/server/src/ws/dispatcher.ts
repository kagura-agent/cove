import type { Message, Channel } from "@cove/shared";
import type { GatewaySession } from "./session.js";
import type { ChannelsRepo } from "../repos/channels.js";
import type { GuildsRepo } from "../repos/guilds.js";
import type { PermissionsRepo } from "../repos/permissions.js";

const VIEW_CHANNEL_BIT = 1n << 10n;

export class GatewayDispatcher {
  private sessions = new Set<GatewaySession>();
  private sessionsById = new Map<string, GatewaySession>();
  private userSessions = new Map<string, Set<string>>();
  private permissionsRepo: PermissionsRepo | null = null;

  constructor(private channelsRepo: ChannelsRepo, private guildsRepo?: GuildsRepo) {}

  setPermissionsRepo(repo: PermissionsRepo): void {
    this.permissionsRepo = repo;
  }

  addSession(session: GatewaySession): void {
    this.sessions.add(session);
    this.sessionsById.set(session.id, session);
    if (session.user) {
      const userId = session.user.id;
      if (!this.userSessions.has(userId)) {
        this.userSessions.set(userId, new Set());
      }
      this.userSessions.get(userId)!.add(session.id);
      if (this.userSessions.get(userId)!.size === 1) {
        this.presenceUpdate(userId, "online");
      }
    }
  }

  removeSession(session: GatewaySession): void {
    if (session.user) {
      const userId = session.user.id;
      const sessions = this.userSessions.get(userId);
      if (sessions) {
        sessions.delete(session.id);
        if (sessions.size === 0) {
          // Broadcast before removing indexes. Use dying session's guild IDs directly
          // since userSessions no longer contains it.
          this.broadcastToGuilds(session.guildIds, "PRESENCE_UPDATE", {
            user: { id: userId },
            status: "offline",
          }, session.id);
          this.userSessions.delete(userId);
        }
      }
    }
    this.sessions.delete(session);
    this.sessionsById.delete(session.id);
  }

  getOnlineUserIds(): string[] {
    return Array.from(this.userSessions.keys());
  }

  getSessionGuildIds(userId: string): string[] {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return [];
    const guildIds = new Set<string>();
    for (const sid of sessionIds) {
      const session = this.sessionsById.get(sid);
      if (session) {
        for (const gid of session.guildIds) {
          guildIds.add(gid);
        }
      }
    }
    return Array.from(guildIds);
  }

  messageCreate(message: Message): void {
    const guildId = this.resolveGuildForChannel(message.channel_id);
    if (!guildId) return;
    this.broadcastToGuildWithChannelFilter(guildId, message.channel_id, "MESSAGE_CREATE", message);
  }

  messageUpdate(message: Message): void {
    const guildId = this.resolveGuildForChannel(message.channel_id);
    if (!guildId) return;
    this.broadcastToGuildWithChannelFilter(guildId, message.channel_id, "MESSAGE_UPDATE", message);
  }

  messageDelete(channelId: string, messageId: string): void {
    const guildId = this.resolveGuildForChannel(channelId);
    if (!guildId) return;
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "MESSAGE_DELETE", { id: messageId, channel_id: channelId, guild_id: guildId });
  }

  messageDeleteBulk(channelId: string, messageIds: string[], guildId: string): void {
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "MESSAGE_DELETE_BULK", { ids: messageIds, channel_id: channelId, guild_id: guildId });
  }

  channelCreate(channel: Channel): void {
    this.broadcastToGuild(channel.guild_id, "CHANNEL_CREATE", channel);
  }

  channelUpdate(channel: Channel): void {
    this.broadcastToGuild(channel.guild_id, "CHANNEL_UPDATE", channel);
  }

  channelDelete(guildId: string, channelId: string): void {
    this.broadcastToGuild(guildId, "CHANNEL_DELETE", { id: channelId, guild_id: guildId });
  }

  typingStart(channelId: string, user: { id: string; username: string }, guildId: string): void {
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "TYPING_START", {
      channel_id: channelId,
      user_id: user.id,
      username: user.username,
      timestamp: Date.now(),
    });
  }

  messageAck(userId: string, channelId: string, messageId: string): void {
    this.sendToUser(userId, "MESSAGE_ACK", { channel_id: channelId, message_id: messageId });
  }

  private presenceUpdate(userId: string, status: "online" | "offline"): void {
    this.broadcastToGuildMembers(userId, "PRESENCE_UPDATE", {
      user: { id: userId },
      status,
    });
  }

  addGuildToUser(userId: string, guildId: string): void {
    const sessionIds = this.userSessions.get(userId);
    if (sessionIds) {
      for (const sid of sessionIds) {
        const session = this.sessionsById.get(sid);
        if (session) session.guildIds.add(guildId);
      }
    }
    // Notify the user's sessions about the new guild membership
    const guild = this.guildsRepo?.getById(guildId);
    if (guild) {
      this.sendToUser(userId, "GUILD_CREATE", guild);
    }
  }

  removeGuildFromUser(userId: string, guildId: string): void {
    // Notify the user's sessions BEFORE removing the guild from their set
    this.sendToUser(userId, "GUILD_DELETE", { id: guildId });
    const sessionIds = this.userSessions.get(userId);
    if (sessionIds) {
      for (const sid of sessionIds) {
        const session = this.sessionsById.get(sid);
        if (session) session.guildIds.delete(guildId);
      }
    }
  }

  guildMemberAdd(guildId: string, member: { user: { id: string }; nick: string | null; roles: string[]; joined_at: string }): void {
    this.broadcastToGuild(guildId, "GUILD_MEMBER_ADD", { ...member, guild_id: guildId });
  }

  guildMemberRemove(guildId: string, userId: string): void {
    this.broadcastToGuild(guildId, "GUILD_MEMBER_REMOVE", { guild_id: guildId, user: { id: userId } });
  }

  private resolveGuildForChannel(channelId: string): string | null {
    // TODO(#111): DM channels have guild_id == null. When DMs are implemented,
    // add a broadcastToRecipients path that sends to DM participants directly.
    const channel = this.channelsRepo.getById(channelId);
    return channel?.guild_id ?? null;
  }

  private broadcastToGuild(guildId: string, event: string, data: unknown): void {
    for (const session of this.sessions) {
      if (session.guildIds.has(guildId)) {
        session.dispatch(event, data);
      }
    }
  }

  private broadcastToGuildWithChannelFilter(guildId: string, channelId: string, event: string, data: unknown): void {
    for (const session of this.sessions) {
      if (!session.guildIds.has(guildId)) continue;
      if (session.user?.bot && this.permissionsRepo) {
        if (!this.permissionsRepo.hasPermission(channelId, session.user.id, VIEW_CHANNEL_BIT)) {
          continue;
        }
      }
      session.dispatch(event, data);
    }
  }

  private sendToUser(userId: string, event: string, data: unknown): void {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return;
    for (const sid of sessionIds) {
      const session = this.sessionsById.get(sid);
      if (session) session.dispatch(event, data);
    }
  }

  /** Get online users who share at least one guild with the given guild set. Single-pass O(sessions). */
  getSharedGuildPresences(guildIds: Set<string>): { user: { id: string }; status: "online" }[] {
    const seen = new Set<string>();
    const presences: { user: { id: string }; status: "online" }[] = [];
    for (const session of this.sessions) {
      if (!session.user || seen.has(session.user.id)) continue;
      for (const gid of session.guildIds) {
        if (guildIds.has(gid)) {
          seen.add(session.user.id);
          presences.push({ user: { id: session.user.id }, status: "online" });
          break;
        }
      }
    }
    return presences;
  }

  reactionAdd(channelId: string, messageId: string, userId: string, emoji: string, guildId: string, count: number): void {
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "MESSAGE_REACTION_ADD", {
      user_id: userId,
      channel_id: channelId,
      message_id: messageId,
      guild_id: guildId,
      emoji: { id: null, name: emoji },
      count,
    });
  }

  reactionRemove(channelId: string, messageId: string, userId: string, emoji: string, guildId: string, count: number): void {
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "MESSAGE_REACTION_REMOVE", {
      user_id: userId,
      channel_id: channelId,
      message_id: messageId,
      guild_id: guildId,
      emoji: { id: null, name: emoji },
      count,
    });
  }

  removeUser(userId: string): void {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return;
    const toRemove: GatewaySession[] = [];
    for (const sid of sessionIds) {
      const session = this.sessionsById.get(sid);
      if (session) toRemove.push(session);
    }
    for (const session of toRemove) {
      this.removeSession(session);
      session.close(4004, "User deleted");
    }
  }

  private broadcastToGuildMembers(userId: string, event: string, data: unknown, excludeSessionId?: string): void {
    const userGuildIds = this.getSessionGuildIds(userId);
    this.broadcastToGuilds(new Set(userGuildIds), event, data, excludeSessionId);
  }

  /** Broadcast to all sessions in any of the given guilds, deduplicating. */
  private broadcastToGuilds(guildIds: Set<string>, event: string, data: unknown, excludeSessionId?: string): void {
    for (const session of this.sessions) {
      if (excludeSessionId && session.id === excludeSessionId) continue;
      for (const gid of session.guildIds) {
        if (guildIds.has(gid)) {
          session.dispatch(event, data);
          break;
        }
      }
    }
  }
}
