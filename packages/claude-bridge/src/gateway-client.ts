/**
 * Cove Gateway WebSocket client for the Claude bridge.
 *
 * Simplified version of packages/plugin/src/gateway-client.ts.
 * Connects to the Cove Gateway (Discord-compatible protocol), handles
 * heartbeating, sequence tracking, RESUME on reconnect, and auto-reconnection.
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { GatewayOpcode } from "@cove/shared";
import type { GatewayPayload, Message } from "@cove/shared";

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const RESUME_TIMEOUT_MS = 5_000;

export interface GatewayEvents {
  ready: (user: { id: string; username: string }) => void;
  messageCreate: (message: Message) => void;
  error: (error: Error) => void;
  close: () => void;
  reconnect: () => void;
  resumed: () => void;
}

type TypedEmitter<T> = {
  on<K extends keyof T>(event: K, listener: T[K]): TypedEmitter<T>;
  off<K extends keyof T>(event: K, listener: T[K]): TypedEmitter<T>;
  emit<K extends keyof T>(event: K, ...args: Parameters<T[K] & ((...args: any[]) => any)>): boolean;
} & EventEmitter;

export interface GatewayClientOptions {
  /** WebSocket URL, e.g. wss://staging.cove.example.com/gateway */
  url: string;
  /** Bot token for IDENTIFY. */
  token: string;
}

export class GatewayClient extends (EventEmitter as new () => TypedEmitter<GatewayEvents>) {
  private readonly url: string;
  private readonly token: string;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAcked = true;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private invalidSessionTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private hasConnectedOnce = false;

  private seq: number | null = null;
  private sessionId: string | null = null;
  private resuming = false;

  /** The bot user from the READY event. */
  public botUser: { id: string; username: string } | null = null;

  constructor(options: GatewayClientOptions) {
    super();
    this.url = options.url;
    this.token = options.token;
  }

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

    ws.on("close", (code, reason) => {
      console.log(`[gateway] WS closed: code=${code}, reason=${reason?.toString()}`);
      this.stopHeartbeat();
      this.clearResumeTimer();
      if (!this.destroyed) {
        this.emit("close");
        this.scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      console.error(`[gateway] WS error:`, err.message);
      this.emit("error", err);
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.cleanup();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.invalidSessionTimer) {
      clearTimeout(this.invalidSessionTimer);
      this.invalidSessionTimer = null;
    }
    this.clearResumeTimer();
  }

  private handlePayload(payload: GatewayPayload): void {
    switch (payload.op) {
      case GatewayOpcode.HELLO: {
        const data = payload.d as { heartbeat_interval: number };
        this.startHeartbeat(data.heartbeat_interval);
        if (this.sessionId && this.seq !== null) {
          this.sendResume();
        } else {
          this.sendIdentify();
        }
        break;
      }

      case GatewayOpcode.HEARTBEAT_ACK:
        this.heartbeatAcked = true;
        break;

      case GatewayOpcode.DISPATCH: {
        if (payload.s != null) this.seq = payload.s;
        this.handleDispatch(payload);
        break;
      }

      case GatewayOpcode.INVALID_SESSION: {
        this.clearResumeTimer();
        this.resuming = false;
        this.sessionId = null;
        this.seq = null;
        const currentWs = this.ws;
        this.invalidSessionTimer = setTimeout(() => {
          if (this.ws === currentWs && this.ws?.readyState === WebSocket.OPEN) {
            this.sendIdentify();
          }
        }, 1000 + Math.random() * 4000);
        break;
      }

      case GatewayOpcode.RECONNECT:
        this.ws?.close(4000, "Server requested reconnect");
        break;

      default:
        break;
    }
  }

  private handleDispatch(payload: GatewayPayload): void {
    switch (payload.t) {
      case "READY": {
        this.clearResumeTimer();
        this.resuming = false;
        const data = payload.d as {
          user: { id: string; username: string; bot: boolean };
          session_id: string;
        };
        this.botUser = { id: data.user.id, username: data.user.username };
        this.sessionId = data.session_id;
        if (this.hasConnectedOnce) this.emit("reconnect");
        this.hasConnectedOnce = true;
        this.emit("ready", this.botUser);
        break;
      }

      case "RESUMED":
        this.clearResumeTimer();
        this.resuming = false;
        this.hasConnectedOnce = true;
        this.emit("resumed");
        break;

      case "MESSAGE_CREATE":
        this.emit("messageCreate", payload.d as Message);
        break;

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

  private sendResume(): void {
    this.resuming = true;
    this.send({
      op: GatewayOpcode.RESUME,
      d: { token: this.token, session_id: this.sessionId, seq: this.seq },
      s: null,
      t: null,
    });
    this.resumeTimer = setTimeout(() => {
      if (this.resuming) {
        this.resuming = false;
        this.sessionId = null;
        this.seq = null;
        this.sendIdentify();
      }
    }, RESUME_TIMEOUT_MS);
  }

  private clearResumeTimer(): void {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatAcked = true;
    this.heartbeatTimer = setInterval(() => {
      if (!this.heartbeatAcked) {
        this.ws?.close(4000, "Heartbeat timeout");
        return;
      }
      this.heartbeatAcked = false;
      this.send({ op: GatewayOpcode.HEARTBEAT, d: this.seq, s: null, t: null });
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
    this.clearResumeTimer();
    if (this.invalidSessionTimer) {
      clearTimeout(this.invalidSessionTimer);
      this.invalidSessionTimer = null;
    }
    this.resuming = false;
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, "Cleanup");
      }
      this.ws = null;
    }
  }
}
