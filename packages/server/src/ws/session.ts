import { WebSocket } from "ws";
import { generateSnowflake, GatewayOpcode, type GatewayPayload } from "@cove/shared";
import type { GatewayDispatcher } from "./dispatcher.js";
import type { GuildsRepo } from "../repos/guilds.js";
import type { ChannelsRepo } from "../repos/channels.js";
import type { ReadStatesRepo } from "../repos/readStates.js";
import type { PermissionsRepo } from "../repos/permissions.js";

const VIEW_CHANNEL_BIT = 1n << 10n;

export class GatewaySession {
  readonly id: string;
  private seq = 0;
  private identified = false;
  user: { id: string; username: string; bot: boolean; avatar: string | null; discriminator: string; global_name: string | null } | null = null;
  readonly guildIds: Set<string> = new Set();

  constructor(private ws: WebSocket) {
    this.id = generateSnowflake();
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

  identify(user: { id: string; username: string; bot: boolean; avatar: string | null; discriminator: string; global_name: string | null }, dispatcher: GatewayDispatcher, guildsRepo: GuildsRepo, channelsRepo: ChannelsRepo, readStatesRepo: ReadStatesRepo, permissionsRepo?: PermissionsRepo): void {
    this.user = user;
    this.identified = true;

    const guilds = guildsRepo.listForUser(user.id);
    for (const guild of guilds) {
      this.guildIds.add(guild.id);
    }

    const guildsWithChannels = guilds.map((g) => {
      const allChannels = channelsRepo.list(g.id);
      const channels = user.bot && permissionsRepo
        ? allChannels.filter(ch => permissionsRepo.hasPermission(ch.id, user.id, VIEW_CHANNEL_BIT))
        : allChannels;
      return { ...g, channels };
    });

    const presences = dispatcher.getSharedGuildPresences(this.guildIds);
    const readState = readStatesRepo.getAllForUserWithLastMessage(user.id);

    this.seq++;
    this.ws.send(JSON.stringify({
      op: GatewayOpcode.DISPATCH,
      s: this.seq,
      t: "READY",
      d: {
        v: 10,
        user,
        guilds: guildsWithChannels,
        session_id: this.id,
        presences,
        read_state: readState,
      },
    }));
  }

  close(code: number, reason: string): void {
    this.ws.close(code, reason);
  }
}
