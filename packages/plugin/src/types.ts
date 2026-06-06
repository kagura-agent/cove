/**
 * Cove OpenClaw Plugin — Type definitions.
 *
 * Re-exports Discord-compatible types from @cove/shared and defines
 * plugin-specific configuration types.
 */

export type {
  User,
  Channel,
  Message,
  GatewayOpcode,
  GatewayPayload,
} from "@cove/shared";

import type { Channel, Message } from "@cove/shared";

/** Resolved account configuration for the Cove channel. */
export interface CoveAccount {
  accountId: string | null;
  token: string;
  baseUrl: string;
  /** Guild ID. Comes from config override or discovered from READY event. */
  guildId: string | null;
  agentId: string;
  agentName: string;
  allowFrom: string[];
  dmPolicy: string | undefined;
}

/** Gateway client events. */
export interface GatewayEvents {
  ready: (user: { id: string; username: string }) => void;
  messageCreate: (message: Message) => void;
  messageUpdate: (message: Partial<Message> & { id: string; channel_id: string }) => void;
  messageDelete: (payload: { id: string; channel_id: string; guild_id?: string }) => void;
  channelCreate: (channel: Channel) => void;
  channelUpdate: (channel: Channel) => void;
  channelDelete: (channel: Channel) => void;
  guildMemberAdd: (member: { user: { id: string; username: string }; guild_id: string }) => void;
  guildMemberRemove: (payload: { user: { id: string; username: string }; guild_id: string }) => void;
  presenceUpdate: (presence: { user: { id: string }; status: string }) => void;
  typingStart: (payload: { channel_id: string; user_id: string; timestamp: number }) => void;
  error: (error: Error) => void;
  close: () => void;
  reconnect: () => void;
}
