import type { Message, Channel } from "@cove/shared";
import type { GatewaySession } from "./session.js";
import type { ChannelsRepo } from "../repos/channels.js";
import type { GuildsRepo } from "../repos/guilds.js";

export class GatewayDispatcher {
  private sessions = new Set<GatewaySession>();
  private userSessions = new Map<string, Set<string>>();

  constructor(private channelsRepo: ChannelsRepo, private guildsRepo?: GuildsRepo) {}

  addSession(session: GatewaySession): void {
    this.sessions.add(session);
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
          this.userSessions.delete(userId);
          // Broadcast before removing from sessions so guild IDs are still accessible.
          // Exclude the dying session so it doesn't receive its own offline event.
          this.broadcastToGuildMembers(userId, "PRESENCE_UPDATE", {
            user: { id: userId },
            status: "offline",
          }, session.id);
        }
      }
    }
    this.sessions.delete(session);
  }

  getOnlineUserIds(): string[] {
    return Array.from(this.userSessions.keys());
  }

  getSessionGuildIds(userId: string): string[] {
    const guildIds = new Set<string>();
    for (const session of this.sessions) {
      if (session.user?.id === userId) {
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
    this.broadcastToGuild(guildId, "MESSAGE_CREATE", message);
  }

  messageUpdate(message: Message): void {
    const guildId = this.resolveGuildForChannel(message.channel_id);
    if (!guildId) return;
    this.broadcastToGuild(guildId, "MESSAGE_UPDATE", message);
  }

  messageDelete(channelId: string, messageId: string): void {
    const guildId = this.resolveGuildForChannel(channelId);
    if (!guildId) return;
    this.broadcastToGuild(guildId, "MESSAGE_DELETE", { id: messageId, channel_id: channelId });
  }

  messageDeleteBulk(channelId: string, messageIds: string[], guildId: string): void {
    this.broadcastToGuild(guildId, "MESSAGE_DELETE_BULK", { ids: messageIds, channel_id: channelId, guild_id: guildId });
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
    this.broadcastToGuild(guildId, "TYPING_START", {
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
    for (const session of this.sessions) {
      if (session.user?.id === userId) {
        session.guildIds.add(guildId);
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
    for (const session of this.sessions) {
      if (session.user?.id === userId) {
        session.guildIds.delete(guildId);
      }
    }
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

  private sendToUser(userId: string, event: string, data: unknown): void {
    for (const session of this.sessions) {
      if (session.user?.id === userId) {
        session.dispatch(event, data);
      }
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

  removeUser(userId: string): void {
    const toRemove: GatewaySession[] = [];
    for (const session of this.sessions) {
      if (session.user?.id === userId) {
        toRemove.push(session);
      }
    }
    for (const session of toRemove) {
      this.removeSession(session);
      session.close(4004, "User deleted");
    }
  }

  private broadcastToGuildMembers(userId: string, event: string, data: unknown, excludeSessionId?: string): void {
    const userGuildIds = this.getSessionGuildIds(userId);
    for (const session of this.sessions) {
      if (excludeSessionId && session.id === excludeSessionId) continue;
      if (userGuildIds.some((gid) => session.guildIds.has(gid))) {
        session.dispatch(event, data);
      }
    }
  }
}
