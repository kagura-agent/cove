import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { GatewayOpcode, type GatewayPayload } from "@cove/shared";
import type { GatewayDispatcher } from "./dispatcher.js";
import type { GuildsRepo } from "../repos/guilds.js";

export class GatewaySession {
  readonly id: string;
  private seq = 0;
  private identified = false;
  user: { id: string; username: string; bot: boolean } | null = null;
  readonly guildIds: Set<string> = new Set();

  constructor(private ws: WebSocket) {
    this.id = randomUUID();
  }

  get isIdentified(): boolean {
    return this.identified;
  }

  dispatch(eventName: string, data: unknown): void {
    if (!this.identified || this.ws.readyState !== WebSocket.OPEN) return;
    this.seq++;
    this.ws.send(JSON.stringify({
      op: GatewayOpcode.DISPATCH,
      s: this.seq,
      t: eventName,
      d: data,
    }));
  }

  send(payload: GatewayPayload): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  identify(user: { id: string; username: string; bot: boolean }, dispatcher: GatewayDispatcher, guildsRepo: GuildsRepo): void {
    this.user = user;
    this.identified = true;

    const guilds = guildsRepo.listForUser(user.id);
    for (const guild of guilds) {
      this.guildIds.add(guild.id);
    }

    const presences = dispatcher.getSharedGuildPresences(this.guildIds);

    this.seq++;
    this.ws.send(JSON.stringify({
      op: GatewayOpcode.DISPATCH,
      s: this.seq,
      t: "READY",
      d: {
        v: 10,
        user,
        guilds,
        session_id: this.id,
        presences,
      },
    }));
  }

  close(code: number, reason: string): void {
    this.ws.close(code, reason);
  }
}
