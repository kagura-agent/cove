import { create } from "zustand";
import { dispatcher } from "../lib/gateway-dispatcher";
import type { GatewayEventMap } from "../lib/gateway-dispatcher";

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

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    ws.onopen = () => {
      set({ status: "connected" });
      reconnectDelay = 1000;
    };

    ws.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data) as { t?: string; op?: number; d?: unknown };
        if (payload.op === 10) {
          const token = localStorage.getItem("cove-token");
          if (!token) { ws?.close(); return; }
          ws?.send(JSON.stringify({ op: 2, d: { token } }));
          const interval = (payload.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 41250;
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          heartbeatInterval = setInterval(() => {
            ws?.send(JSON.stringify({ op: 1, d: null }));
          }, interval);
          return;
        }
        if (payload.op === 11) {
          return;
        }
        if (payload.t && payload.t in gatewayEvents) {
          dispatcher.emit(payload.t as keyof GatewayEventMap, payload.d as GatewayEventMap[keyof GatewayEventMap]);
        }
      } catch { /* ignore non-JSON */ }
    };

    ws.onclose = () => {
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
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

const gatewayEvents: Record<string, true> = {
  MESSAGE_CREATE: true,
  MESSAGE_UPDATE: true,
  MESSAGE_DELETE: true,
  TYPING_START: true,
  PRESENCE_UPDATE: true,
  READY: true,
  CHANNEL_CREATE: true,
  CHANNEL_UPDATE: true,
  CHANNEL_DELETE: true,
};
