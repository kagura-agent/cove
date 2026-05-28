import { create } from "zustand";
import type { Message } from "../types";
import { useUserStore } from "./useUserStore";
import { useMessageStore } from "./useMessageStore";
import { useChannelStore } from "./useChannelStore";

type WsStatus = "connected" | "connecting" | "disconnected";

interface TypingUser {
  userId: string;
  username: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface WebSocketState {
  status: WsStatus;
  typingUsers: Record<string, TypingUser[]>;
  connect: () => void;
  disconnect: () => void;
  clearTyping: (channelId: string, userId: string) => void;
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

function getWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/gateway`;
}

export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  status: "disconnected",
  typingUsers: {},
  clearTyping: (channelId, userId) =>
    set((s) => {
      const users = s.typingUsers[channelId];
      if (!users) return s;
      const user = users.find((u) => u.userId === userId);
      if (user) clearTimeout(user.timeout);
      const filtered = users.filter((u) => u.userId !== userId);
      return { typingUsers: { ...s.typingUsers, [channelId]: filtered } };
    }),
  connect: () => {
    if (ws?.readyState === WebSocket.OPEN) return;
    if (ws) { ws.onclose = null; ws.close(); }
    set({ status: "connecting" });
    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      set({ status: "connected" });
      reconnectDelay = 1000;
      const user = useUserStore.getState();
      ws?.send(JSON.stringify({ op: 2, d: { token: "user", user: { id: user.id, username: user.username } } }));
    };

    ws.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data) as { t?: string; op?: number; d?: unknown };
        if (payload.op === 1 || payload.op === 10) {
          ws?.send(JSON.stringify({ op: 1, d: null }));
          return;
        }
        const msgStore = useMessageStore.getState();
        const activeId = useChannelStore.getState().activeChannelId;
        if (payload.t === "MESSAGE_CREATE") {
          const msg = payload.d as Message;
          if (msg.channel_id === activeId) msgStore.addMessage(msg.channel_id, msg);
          get().clearTyping(msg.channel_id, msg.author.id);
        } else if (payload.t === "MESSAGE_UPDATE") {
          const msg = payload.d as Message;
          msgStore.updateMessage(msg.channel_id, msg.id, msg.content, msg.edited_timestamp);
        } else if (payload.t === "MESSAGE_DELETE") {
          const data = payload.d as { id: string; channel_id: string };
          msgStore.removeMessage(data.channel_id, data.id);
        } else if (payload.t === "TYPING_START") {
          const data = payload.d as { channel_id: string; user_id: string; username?: string };
          const selfId = useUserStore.getState().id;
          if (data.user_id === selfId) return;
          const { clearTyping } = get();
          clearTyping(data.channel_id, data.user_id);
          const timeout = setTimeout(() => clearTyping(data.channel_id, data.user_id), 8000);
          set((s) => {
            const existing = s.typingUsers[data.channel_id] ?? [];
            return {
              typingUsers: {
                ...s.typingUsers,
                [data.channel_id]: [...existing, { userId: data.user_id, username: data.username ?? data.user_id, timeout }],
              },
            };
          });
        }
      } catch { /* ignore non-JSON */ }
    };

    ws.onclose = () => {
      const { typingUsers, clearTyping } = get();
      for (const channelId of Object.keys(typingUsers)) {
        for (const entry of typingUsers[channelId] ?? []) {
          clearTyping(channelId, entry.userId);
        }
      }
      set({ status: "disconnected" });
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        useWebSocketStore.getState().connect();
      }, reconnectDelay);
    };

    ws.onerror = () => {};
  },
  disconnect: () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    set({ status: "disconnected" });
  },
}));
