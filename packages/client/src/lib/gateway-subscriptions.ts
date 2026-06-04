import { dispatcher } from "./gateway-dispatcher";
import type { GatewayEventMap } from "./gateway-dispatcher";
import { useMessageStore } from "../stores/useMessageStore";
import { useChannelStore } from "../stores/useChannelStore";
import { usePresenceStore } from "../stores/usePresenceStore";
import { useUserStore } from "../stores/useUserStore";
import { useWebSocketStore } from "../stores/useWebSocketStore";

type Handler<K extends keyof GatewayEventMap> = (data: GatewayEventMap[K]) => void;

let handlers: Array<{ event: keyof GatewayEventMap; handler: Handler<never> }> = [];

function subscribe<K extends keyof GatewayEventMap>(event: K, handler: Handler<K>): void {
  dispatcher.on(event, handler);
  handlers.push({ event, handler: handler as Handler<never> });
}

export function setupGatewaySubscriptions(): void {
  teardownGatewaySubscriptions();

  subscribe("MESSAGE_CREATE", (msg) => {
    const activeId = useChannelStore.getState().activeChannelId;
    if (msg.channel_id === activeId) {
      useMessageStore.getState().addMessage(msg.channel_id, msg);
    }
    useWebSocketStore.getState().clearTyping(msg.channel_id, msg.author.id);
  });

  subscribe("MESSAGE_UPDATE", (msg) => {
    useMessageStore.getState().updateMessage(msg.channel_id, msg.id, msg.content, msg.edited_timestamp);
  });

  subscribe("MESSAGE_DELETE", (data) => {
    useMessageStore.getState().removeMessage(data.channel_id, data.id);
  });

  subscribe("TYPING_START", (data) => {
    const selfId = useUserStore.getState().id;
    if (data.user_id === selfId) return;
    const ws = useWebSocketStore.getState();
    ws.clearTyping(data.channel_id, data.user_id);
    const timeout = setTimeout(() => {
      useWebSocketStore.getState().clearTyping(data.channel_id, data.user_id);
    }, 8000);
    useWebSocketStore.setState((s) => {
      const existing = s.typingUsers[data.channel_id] ?? [];
      return {
        typingUsers: {
          ...s.typingUsers,
          [data.channel_id]: [
            ...existing,
            { userId: data.user_id, username: data.username ?? data.user_id, timeout },
          ],
        },
      };
    });
  });

  subscribe("PRESENCE_UPDATE", (data) => {
    if (data.status === "online") {
      usePresenceStore.getState().setOnline(data.user.id);
    } else {
      usePresenceStore.getState().setOffline(data.user.id);
    }
  });

  subscribe("READY", (data) => {
    if (data.presences) {
      usePresenceStore.getState().initPresences(
        data.presences.filter((p) => p.status === "online").map((p) => p.user.id),
      );
    }
  });

  subscribe("CHANNEL_CREATE", (channel) => {
    useChannelStore.getState().addChannel(channel);
  });

  subscribe("CHANNEL_UPDATE", (channel) => {
    useChannelStore.getState().updateChannel(channel);
  });

  subscribe("CHANNEL_DELETE", (data) => {
    useChannelStore.getState().removeChannel(data.id);
  });
}

export function teardownGatewaySubscriptions(): void {
  for (const { event, handler } of handlers) {
    dispatcher.off(event, handler);
  }
  handlers = [];
}
