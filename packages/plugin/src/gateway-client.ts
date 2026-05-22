/**
 * Cove Gateway WebSocket client.
 *
 * Connects to the Cove Gateway (Discord-compatible protocol) and emits
 * events for MESSAGE_CREATE and READY. Handles heartbeating and
 * auto-reconnection with exponential backoff.
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { GatewayOpcode } from "@cove/shared";
import type { GatewayPayload } from "@cove/shared";
import type { GatewayEvents } from "./types.js";

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

export interface CoveGatewayClientOptions {
  /** WebSocket URL, e.g. ws://localhost:3400/gateway */
  url: string;
  /** Bot token for IDENTIFY. */
  token: string;
}

type TypedEmitter<T> = {
  on<K extends keyof T>(event: K, listener: T[K]): TypedEmitter<T>;
  emit<K extends keyof T>(event: K, ...args: Parameters<T[K] & ((...args: any[]) => any)>): boolean;
} & EventEmitter;

export class CoveGatewayClient extends (EventEmitter as new () => TypedEmitter<GatewayEvents>) {
  private readonly url: string;
  private readonly token: string;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAcked = true;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  /** The bot user returned from the READY event. */
  public botUser: { id: string; username: string } | null = null;

  constructor(options: CoveGatewayClientOptions) {
    super();
    this.url = options.url;
    this.token = options.token;
  }

  /** Open the WebSocket connection. */
  connect(): void {
    if (this.destroyed) return;
    this.cleanup();

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    });

    ws.on("message", (raw) => {
      let payload: GatewayPayload;
      try {
        payload = JSON.parse(raw.toString()) as GatewayPayload;
      } catch {
        return;
      }
      this.handlePayload(payload);
    });

    ws.on("close", () => {
      this.stopHeartbeat();
      if (!this.destroyed) {
        this.emit("close");
        this.scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      this.emit("error", err);
    });
  }

  /** Cleanly disconnect and prevent reconnection. */
  destroy(): void {
    this.destroyed = true;
    this.cleanup();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handlePayload(payload: GatewayPayload): void {
    switch (payload.op) {
      case GatewayOpcode.HELLO: {
        const data = payload.d as { heartbeat_interval: number };
        this.startHeartbeat(data.heartbeat_interval);
        this.sendIdentify();
        break;
      }

      case GatewayOpcode.HEARTBEAT_ACK: {
        this.heartbeatAcked = true;
        break;
      }

      case GatewayOpcode.DISPATCH: {
        this.handleDispatch(payload);
        break;
      }

      default:
        break;
    }
  }

  private handleDispatch(payload: GatewayPayload): void {
    switch (payload.t) {
      case "READY": {
        const data = payload.d as {
          user: { id: string; username: string; bot: boolean };
          session_id: string;
        };
        this.botUser = { id: data.user.id, username: data.user.username };
        this.emit("ready", this.botUser);
        break;
      }

      case "MESSAGE_CREATE": {
        this.emit("messageCreate", payload.d);
        break;
      }

      default:
        break;
    }
  }

  private sendIdentify(): void {
    this.send({
      op: GatewayOpcode.IDENTIFY,
      d: { token: this.token },
      s: null,
      t: null,
    });
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatAcked = true;

    this.heartbeatTimer = setInterval(() => {
      if (!this.heartbeatAcked) {
        // Zombie connection — reconnect
        this.ws?.close(4000, "Heartbeat timeout");
        return;
      }
      this.heartbeatAcked = false;
      this.send({
        op: GatewayOpcode.HEARTBEAT,
        d: null,
        s: null,
        t: null,
      });
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private send(payload: GatewayPayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;

    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, "Cleanup");
      }
      this.ws = null;
    }
  }
}
