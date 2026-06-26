import { create } from "zustand";
import { dispatcher } from "../lib/gateway-dispatcher";
import type { GatewayEventMap } from "../lib/gateway-dispatcher";
import { useTypingStore } from "./useTypingStore";
import { GatewayOpcode } from "@cove/shared";

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

export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  status: "disconnected",
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
        if (payload.op === GatewayOpcode.HELLO) {
          // BFF: server authenticated at WebSocket upgrade via session cookie.
          // Send IDENTIFY without token — bot clients use Authorization header instead.
          ws?.send(JSON.stringify({ op: GatewayOpcode.IDENTIFY, d: { token: null } }));
          const interval = (payload.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 41250;
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          heartbeatInterval = setInterval(() => {
            ws?.send(JSON.stringify({ op: GatewayOpcode.HEARTBEAT, d: null }));
          }, interval);
          return;
        }
        if (payload.op === GatewayOpcode.HEARTBEAT_ACK) {
          return;
        }
        if (payload.t && payload.op === GatewayOpcode.DISPATCH) {
          dispatcher.emit(payload.t as keyof GatewayEventMap, payload.d as GatewayEventMap[keyof GatewayEventMap]);
        }
      } catch { /* ignore non-JSON */ }
    };

    ws.onclose = () => {
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      const { typingUsers, clearTyping } = useTypingStore.getState();
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

