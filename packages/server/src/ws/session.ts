import { WebSocket } from "ws";
import { generateSnowflake, GatewayOpcode, PermissionBits, type GatewayPayload } from "@cove/shared";
import type { GatewayDispatcher } from "./dispatcher.js";
import type { GuildsRepo } from "../repos/guilds.js";
import type { ChannelsRepo } from "../repos/channels.js";
import type { ReadStatesRepo } from "../repos/readStates.js";
import type { PermissionsRepo } from "../repos/permissions.js";
import type { RolesRepo } from "../repos/roles.js";
import type { MembersRepo } from "../repos/members.js";
import { computePermissions } from "../permissions/compute.js";

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

  identify(user: { id: string; username: string; bot: boolean; avatar: string | null; discriminator: string; global_name: string | null }, dispatcher: GatewayDispatcher, guildsRepo: GuildsRepo, channelsRepo: ChannelsRepo, readStatesRepo: ReadStatesRepo, permissionsRepo?: PermissionsRepo, rolesRepo?: RolesRepo, membersRepo?: MembersRepo): void {
    this.user = user;
    this.identified = true;

    const guilds = guildsRepo.listForUser(user.id);
    for (const guild of guilds) {
      this.guildIds.add(guild.id);
    }

    const guildsWithChannels = guilds.map((g) => {
      const allChannels = channelsRepo.list(g.id);
      const roles = rolesRepo ? rolesRepo.listByGuild(g.id) : [];
      let channels = allChannels;

      // For bot users, filter channels by computed permissions (not just raw overwrites)
      if (user.bot && membersRepo && permissionsRepo) {
        const member = membersRepo.get(g.id, user.id);
        if (member) {
          channels = allChannels.filter(ch => {
            const overwriteChannelId = ch.type === 11 && ch.parent_id ? ch.parent_id : ch.id;
            const overwrites = permissionsRepo.listByChannel(overwriteChannelId);
            const perms = computePermissions(member, ch, g, roles, overwrites);
            return (perms & PermissionBits.VIEW_CHANNEL) !== 0n;
          });
        } else {
          channels = [];
        }
      }

      return { ...g, channels, roles };
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
