import type { Message, Channel } from "../types";

export interface GatewayEventMap {
  MESSAGE_CREATE: Message;
  MESSAGE_UPDATE: Message;
  MESSAGE_DELETE: { id: string; channel_id: string };
  TYPING_START: { channel_id: string; user_id: string; username?: string };
  PRESENCE_UPDATE: { user: { id: string }; status: "online" | "offline" };
  READY: { presences?: Array<{ user: { id: string }; status: string }>; read_state?: Array<{ channel_id: string; last_read_message_id: string | null }> };
  CHANNEL_CREATE: Channel;
  CHANNEL_UPDATE: Channel;
  CHANNEL_DELETE: { id: string };
  MESSAGE_ACK: { channel_id: string; message_id: string };
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
