/**
 * Cove OpenClaw Plugin — Type definitions.
 *
 * Re-exports Discord-compatible types from @cove/shared and defines
 * plugin-specific configuration types.
 */

export type {
  DiscordUser,
  DiscordChannel,
  DiscordMessage,
  GatewayOpcode,
  GatewayPayload,
} from "@cove/shared";

/** Resolved account configuration for the Cove channel. */
export interface CoveAccount {
  accountId: string | null;
  token: string;
  baseUrl: string;
  guildId: string;
  allowFrom: string[];
  dmPolicy: string | undefined;
}

/** Gateway client events. */
export interface GatewayEvents {
  ready: (user: { id: string; username: string }) => void;
  messageCreate: (message: {
    id: string;
    channel_id: string;
    content: string;
    author: { id: string; username: string; bot: boolean };
    timestamp: string;
  }) => void;
  error: (error: Error) => void;
  close: () => void;
}
