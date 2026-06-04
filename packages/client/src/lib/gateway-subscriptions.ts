import { dispatcher } from "./gateway-dispatcher";
import type { GatewayEventMap } from "./gateway-dispatcher";
import { useMessageStore } from "../stores/useMessageStore";
import { useChannelStore } from "../stores/useChannelStore";
import { usePresenceStore } from "../stores/usePresenceStore";
import { useUserStore } from "../stores/useUserStore";
import { useTypingStore, typingTimeoutIds } from "../stores/useTypingStore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handlers: Array<{ event: keyof GatewayEventMap; handler: (data: any) => void }> = [];

function subscribe<K extends keyof GatewayEventMap>(event: K, handler: (data: GatewayEventMap[K]) => void): void {
  dispatcher.on(event, handler);
  handlers.push({ event, handler });
}

export function setupGatewaySubscriptions(): void {
  teardownGatewaySubscriptions();

  subscribe("MESSAGE_CREATE", (msg) => {
    useMessageStore.getState().addMessage(msg.channel_id, msg);
    useTypingStore.getState().clearTyping(msg.channel_id, msg.author.id);
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
    useTypingStore.getState().clearTyping(data.channel_id, data.user_id);
    const timeout = setTimeout(() => {
      typingTimeoutIds.delete(timeout);
      useTypingStore.getState().clearTyping(data.channel_id, data.user_id);
    }, 8000);
    typingTimeoutIds.add(timeout);
    useTypingStore.setState((s) => {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatcher.off(event as any, handler);
  }
  handlers = [];
  for (const id of typingTimeoutIds) {
    clearTimeout(id);
  }
  typingTimeoutIds.clear();
}
