import type { Message, Channel } from "@cove/shared";
import type { GatewaySession } from "./session.js";

export class GatewayDispatcher {
  private sessions = new Set<GatewaySession>();
  private userSessions = new Map<string, Set<string>>();

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
    this.sessions.delete(session);
    if (session.user) {
      const userId = session.user.id;
      const sessions = this.userSessions.get(userId);
      if (sessions) {
        sessions.delete(session.id);
        if (sessions.size === 0) {
          this.userSessions.delete(userId);
          this.presenceUpdate(userId, "offline");
        }
      }
    }
  }

  getOnlineUserIds(): string[] {
    return Array.from(this.userSessions.keys());
  }

  messageCreate(message: Message): void {
    this.broadcast("MESSAGE_CREATE", message);
  }

  messageUpdate(message: Message): void {
    this.broadcast("MESSAGE_UPDATE", message);
  }

  messageDelete(channelId: string, messageId: string): void {
    this.broadcast("MESSAGE_DELETE", { id: messageId, channel_id: channelId });
  }

  channelUpdate(channel: Channel): void {
    this.broadcast("CHANNEL_UPDATE", channel);
  }

  typingStart(channelId: string, user: { id: string; username: string }): void {
    this.broadcast("TYPING_START", {
      channel_id: channelId,
      user_id: user.id,
      username: user.username,
      timestamp: Date.now(),
    });
  }

  private presenceUpdate(userId: string, status: "online" | "offline"): void {
    this.broadcast("PRESENCE_UPDATE", {
      user: { id: userId },
      status,
    });
  }

  private broadcast(event: string, data: unknown): void {
    for (const session of this.sessions) {
      session.dispatch(event, data);
    }
  }
}
