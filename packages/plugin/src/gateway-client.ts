/**
 * Cove Gateway WebSocket client.
 *
 * Connects to the Cove Gateway (Discord-compatible protocol) and emits
 * events for all dispatch event types. Handles heartbeating, sequence
 * tracking, RESUME on reconnect, and auto-reconnection with exponential
 * backoff.
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { GatewayOpcode } from "@cove/shared";
import type { GatewayPayload, Guild, Message, Channel } from "@cove/shared";
import type { GatewayEvents } from "./types.js";

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
/** How long to wait for a response after sending RESUME before falling back to IDENTIFY. */
const RESUME_TIMEOUT_MS = 5_000;

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
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private invalidSessionTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private hasConnectedOnce = false;

  /** Sequence number from the last DISPATCH event, used for RESUME. */
  private seq: number | null = null;

  /** Session ID from the READY payload, used for RESUME. */
  private sessionId: string | null = null;

  /** Whether we are currently attempting a RESUME (waiting for confirmation). */
  private resuming = false;

  /** The bot user returned from the READY event. */
  public botUser: { id: string; username: string } | null = null;

  /** Guilds the bot belongs to, populated from the READY event. */
  public guilds: Guild[] = [];

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
      this.clearResumeTimer();
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
        // Attempt RESUME if we have a prior session, otherwise IDENTIFY
        if (this.sessionId && this.seq !== null) {
          this.sendResume();
        } else {
          this.sendIdentify();
        }
        break;
      }

      case GatewayOpcode.HEARTBEAT_ACK: {
        this.heartbeatAcked = true;
        break;
      }

      case GatewayOpcode.DISPATCH: {
        // Track sequence number for RESUME
        if (payload.s != null) {
          this.seq = payload.s;
        }
        this.handleDispatch(payload);
        break;
      }

      case GatewayOpcode.INVALID_SESSION: {
        // Server rejected RESUME — clear session state and re-IDENTIFY
        this.clearResumeTimer();
        this.resuming = false;
        this.sessionId = null;
        this.seq = null;
        // Small delay before re-identifying (Discord recommends 1-5s)
        const currentWs = this.ws;
        this.invalidSessionTimer = setTimeout(() => {
          if (this.ws === currentWs && this.ws?.readyState === WebSocket.OPEN) {
            this.sendIdentify();
          }
        }, 1000 + Math.random() * 4000);
        break;
      }

      case GatewayOpcode.RECONNECT: {
        // RECONNECT tells us to reconnect but keep session state for RESUME attempt.
        // We preserve seq and sessionId so the next connection can send RESUME
        // and recover without missing events.
        this.ws?.close(4000, "Server requested reconnect");
        break;
      }

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
          guilds?: Guild[];
          session_id: string;
        };
        this.botUser = { id: data.user.id, username: data.user.username };
        this.guilds = data.guilds ?? [];
        this.sessionId = data.session_id;
        if (this.hasConnectedOnce) {
          this.emit("reconnect");
        }
        this.hasConnectedOnce = true;
        this.emit("ready", this.botUser);
        break;
      }

      case "RESUMED": {
        // RESUME was accepted — session continues seamlessly, no replay needed
        this.clearResumeTimer();
        this.resuming = false;
        this.hasConnectedOnce = true;
        this.emit("resumed");
        break;
      }

      case "MESSAGE_CREATE": {
        this.emit("messageCreate", payload.d as Message);
        break;
      }

      case "MESSAGE_UPDATE": {
        this.emit("messageUpdate", payload.d as Partial<Message> & { id: string; channel_id: string });
        break;
      }

      case "MESSAGE_DELETE": {
        this.emit("messageDelete", payload.d as { id: string; channel_id: string; guild_id?: string });
        break;
      }

      case "CHANNEL_CREATE": {
        this.emit("channelCreate", payload.d as Channel);
        break;
      }

      case "CHANNEL_UPDATE": {
        this.emit("channelUpdate", payload.d as Channel);
        break;
      }

      case "CHANNEL_DELETE": {
        this.emit("channelDelete", payload.d as Channel);
        break;
      }

      case "GUILD_MEMBER_ADD": {
        this.emit("guildMemberAdd", payload.d as { user: { id: string; username: string }; guild_id: string });
        break;
      }

      case "GUILD_MEMBER_REMOVE": {
        this.emit("guildMemberRemove", payload.d as { user: { id: string; username: string }; guild_id: string });
        break;
      }

      case "PRESENCE_UPDATE": {
        this.emit("presenceUpdate", payload.d as { user: { id: string }; status: string });
        break;
      }

      case "TYPING_START": {
        this.emit("typingStart", payload.d as { channel_id: string; user_id: string; timestamp: number });
        break;
      }

      case "MESSAGE_REACTION_ADD": {
        this.emit("messageReactionAdd", payload.d as { user_id: string; channel_id: string; message_id: string; guild_id?: string; emoji: { name: string } });
        break;
      }

      case "MESSAGE_REACTION_REMOVE": {
        this.emit("messageReactionRemove", payload.d as { user_id: string; channel_id: string; message_id: string; guild_id?: string; emoji: { name: string } });
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

  private sendResume(): void {
    this.resuming = true;
    this.send({
      op: GatewayOpcode.RESUME,
      d: {
        token: this.token,
        session_id: this.sessionId,
        seq: this.seq,
      },
      s: null,
      t: null,
    });
    // If server doesn't support RESUME, it won't respond — fall back to IDENTIFY after timeout
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
        // Zombie connection — reconnect
        this.ws?.close(4000, "Heartbeat timeout");
        return;
      }
      this.heartbeatAcked = false;
      this.send({
        op: GatewayOpcode.HEARTBEAT,
        d: this.seq,
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

  /** Send a payload over the WebSocket. Private — all sends go through typed methods. */
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
