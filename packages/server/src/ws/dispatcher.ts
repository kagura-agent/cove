import type { DiscordMessage, DiscordChannel, ChannelState } from "@cove/shared";
import type { GatewaySession } from "./session.js";

export class GatewayDispatcher {
  private sessions = new Set<GatewaySession>();

  addSession(session: GatewaySession): void {
    this.sessions.add(session);
  }

  removeSession(session: GatewaySession): void {
    this.sessions.delete(session);
  }

  messageCreate(message: DiscordMessage): void {
    this.broadcast("MESSAGE_CREATE", message);
  }

  messageUpdate(message: DiscordMessage): void {
    this.broadcast("MESSAGE_UPDATE", message);
  }

  messageDelete(channelId: string, messageId: string): void {
    this.broadcast("MESSAGE_DELETE", { id: messageId, channel_id: channelId });
  }

  channelUpdate(channel: DiscordChannel): void {
    this.broadcast("CHANNEL_UPDATE", channel);
  }

  stateUpdate(state: ChannelState): void {
    this.broadcast("STATE_UPDATE", state);
  }

  stateDelete(channelId: string, key: string): void {
    this.broadcast("STATE_DELETE", { channel_id: channelId, key });
  }

  typingStart(channelId: string, user: { id: string; username: string }): void {
    this.broadcast("TYPING_START", {
      channel_id: channelId,
      user_id: user.id,
      username: user.username,
      timestamp: Date.now(),
    });
  }

  private broadcast(event: string, data: unknown): void {
    for (const session of this.sessions) {
      session.dispatch(event, data);
    }
  }
}
