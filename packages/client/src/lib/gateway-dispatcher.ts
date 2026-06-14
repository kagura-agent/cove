import type { Message, Channel, Guild } from "../types";

export interface ReadyGuild extends Guild {
  channels: Channel[];
}

export interface GatewayEventMap {
  MESSAGE_CREATE: Message;
  MESSAGE_UPDATE: Message;
  MESSAGE_DELETE: { id: string; channel_id: string; guild_id?: string };
  MESSAGE_DELETE_BULK: { ids: string[]; channel_id: string };
  TYPING_START: { channel_id: string; user_id: string; username?: string };
  PRESENCE_UPDATE: { user: { id: string }; status: "online" | "offline" };
  READY: { user?: { id: string; username: string; avatar: string | null; bot: boolean }; guilds?: ReadyGuild[]; presences?: Array<{ user: { id: string }; status: string }>; read_state?: Array<{ channel_id: string; last_read_message_id: string | null; last_message_id: string | null }> };
  CHANNEL_CREATE: Channel;
  CHANNEL_UPDATE: Channel;
  CHANNEL_DELETE: { id: string; guild_id: string };
  MESSAGE_ACK: { channel_id: string; message_id: string };
  MESSAGE_REACTION_ADD: { user_id: string; channel_id: string; message_id: string; guild_id: string; emoji: { id: string | null; name: string }; count: number };
  MESSAGE_REACTION_REMOVE: { user_id: string; channel_id: string; message_id: string; guild_id: string; emoji: { id: string | null; name: string }; count: number };
  GUILD_MEMBER_ADD: { guild_id: string; user: { id: string }; nick: string | null; roles: string[]; joined_at: string };
  GUILD_MEMBER_REMOVE: { guild_id: string; user: { id: string } };
  GUILD_CREATE: { id: string; name: string };
  GUILD_DELETE: { id: string };
  CHANNEL_FILE_CREATE: { channel_id: string; guild_id: string; filename: string; content_type: string; size: number };
  CHANNEL_FILE_UPDATE: { channel_id: string; guild_id: string; filename: string; content_type: string; size: number };
  CHANNEL_FILE_DELETE: { channel_id: string; guild_id: string; filename: string };
}

type Handler<T> = (data: T) => void;

class GatewayDispatcher {
  private handlers: { [K in keyof GatewayEventMap]?: Array<Handler<GatewayEventMap[K]>> } = Object.create(null);

  on<K extends keyof GatewayEventMap>(event: K, handler: Handler<GatewayEventMap[K]>): void {
    const list = (this.handlers[event] ?? []) as Array<Handler<GatewayEventMap[K]>>;
    list.push(handler);
    (this.handlers as Record<string, unknown>)[event] = list;
  }

  off<K extends keyof GatewayEventMap>(event: K, handler: Handler<GatewayEventMap[K]>): void {
    const list = this.handlers[event] as Array<Handler<GatewayEventMap[K]>> | undefined;
    if (!list) return;
    (this.handlers as Record<string, unknown>)[event] = list.filter((h) => h !== handler);
  }

  emit<K extends keyof GatewayEventMap>(event: K, data: GatewayEventMap[K]): void {
    const list = this.handlers[event] as Array<Handler<GatewayEventMap[K]>> | undefined;
    if (!list) return;
    for (const handler of [...list]) {
      handler(data);
    }
  }
}

export const dispatcher = new GatewayDispatcher();
