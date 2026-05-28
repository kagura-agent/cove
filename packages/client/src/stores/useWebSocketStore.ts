import { create } from "zustand";
import type { Message } from "../types";
import { useUserStore } from "./useUserStore";
import { useMessageStore } from "./useMessageStore";
import { useChannelStore } from "./useChannelStore";
import { useTypingStore } from "./useTypingStore";

type WsStatus = "connected" | "connecting" | "disconnected";

interface WebSocketState {
  status: WsStatus;
  connect: () => void;
  disconnect: () => void;
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

function getWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/gateway`;
}

export const useWebSocketStore = create<WebSocketState>((set) => ({
  status: "disconnected",
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
          // Clear typing for the message author
          useTypingStore.getState().clearTyping(msg.channel_id, msg.author.id);
        } else if (payload.t === "MESSAGE_UPDATE") {
          const msg = payload.d as Message;
          msgStore.updateMessage(msg.channel_id, msg.id, msg.content);
        } else if (payload.t === "MESSAGE_DELETE") {
          const data = payload.d as { id: string; channel_id: string };
          msgStore.removeMessage(data.channel_id, data.id);
        } else if (payload.t === "TYPING_START") {
          const data = payload.d as { channel_id: string; user_id: string; username?: string };
          const myId = useUserStore.getState().id;
          if (data.user_id === myId) return; // Don't show own typing
          useTypingStore.getState().addTyping(data.channel_id, data.user_id, data.username ?? data.user_id);
        }
      } catch { /* ignore non-JSON */ }
    };

    ws.onclose = () => {
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
