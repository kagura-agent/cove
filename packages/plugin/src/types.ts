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

import type { Message } from "@cove/shared";

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
  error: (error: Error) => void;
  close: () => void;
  reconnect: () => void;
}
