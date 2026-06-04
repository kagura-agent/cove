import type { Message, Channel } from "@cove/shared";
import type { GatewaySession } from "./session.js";
import type { ChannelsRepo } from "../repos/channels.js";

export class GatewayDispatcher {
  private sessions = new Set<GatewaySession>();
  private userSessions = new Map<string, Set<string>>();

  constructor(private channelsRepo?: ChannelsRepo) {}

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
          // Broadcast before removing from sessions so guild IDs are still accessible
          this.broadcastToGuildMembers(userId, "PRESENCE_UPDATE", {
            user: { id: userId },
            status: "offline",
          });
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

  channelUpdate(channel: Channel): void {
    this.broadcastToGuild(channel.guild_id, "CHANNEL_UPDATE", channel);
  }

  typingStart(channelId: string, user: { id: string; username: string }, guildId: string): void {
    this.broadcastToGuild(guildId, "TYPING_START", {
      channel_id: channelId,
      user_id: user.id,
      username: user.username,
      timestamp: Date.now(),
    });
  }

  private presenceUpdate(userId: string, status: "online" | "offline"): void {
    this.broadcastToGuildMembers(userId, "PRESENCE_UPDATE", {
      user: { id: userId },
      status,
    });
  }

  private resolveGuildForChannel(channelId: string): string | null {
    if (!this.channelsRepo) return null;
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

  private broadcastToGuildMembers(userId: string, event: string, data: unknown): void {
    const userGuildIds = this.getSessionGuildIds(userId);
    for (const session of this.sessions) {
      if (userGuildIds.some((gid) => session.guildIds.has(gid))) {
        session.dispatch(event, data);
      }
    }
  }
}
