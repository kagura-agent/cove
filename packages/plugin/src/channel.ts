/**
 * Cove channel plugin definition.
 *
 * Registers Cove as an OpenClaw channel using the plugin SDK.
 * Handles account resolution, DM security, and outbound messaging.
 */

import {
  createChatChannelPlugin,
  createChannelPluginBase,
} from "openclaw/plugin-sdk/channel-core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import type { CoveAccount } from "./types.js";
import { CoveRestClient } from "./rest-client.js";

/** Active REST clients keyed by baseUrl+token for reuse. */
const restClients = new Map<string, CoveRestClient>();

function getRestClient(baseUrl: string, token: string): CoveRestClient {
  const key = `${baseUrl}::${token}`;
  let client = restClients.get(key);
  if (!client) {
    client = new CoveRestClient(baseUrl, token);
    restClients.set(key, client);
  }
  return client;
}

function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): CoveAccount {
  const section = (cfg.channels as Record<string, any>)?.["cove"];
  const token = section?.token ?? process.env["COVE_BOT_TOKEN"] ?? "";
  const baseUrl = section?.baseUrl ?? process.env["COVE_BASE_URL"] ?? "http://localhost:3400";

  if (!token) {
    throw new Error("cove: bot token is required (set channels.cove.token or COVE_BOT_TOKEN env)");
  }

  return {
    accountId: accountId ?? null,
    token,
    baseUrl,
    guildId: section?.guildId ?? "cove",
    allowFrom: section?.allowFrom ?? [],
    dmPolicy: section?.dmSecurity,
  };
}

export const coveChannelPlugin = createChatChannelPlugin<CoveAccount>({
  base: createChannelPluginBase({
    id: "cove",
    setup: {
      resolveAccount,
      inspectAccount(cfg: OpenClawConfig) {
        const section = (cfg.channels as Record<string, any>)?.["cove"];
        const token = section?.token ?? process.env["COVE_BOT_TOKEN"];
        return {
          enabled: Boolean(token),
          configured: Boolean(token),
          tokenStatus: token ? "available" : "missing",
        };
      },
    },
  }),

  // DM security: who can message the bot
  security: {
    dm: {
      channelKey: "cove",
      resolvePolicy: (account: CoveAccount) => account.dmPolicy,
      resolveAllowFrom: (account: CoveAccount) => account.allowFrom,
      defaultPolicy: "allowlist",
    },
  },

  // Threading: replies go to the same channel
  threading: { topLevelReplyToMode: "reply" },

  // Outbound: send messages to Cove via REST API
  outbound: {
    attachedResults: {
      sendText: async (params: { to: string; text: string; account: CoveAccount }) => {
        const client = getRestClient(params.account.baseUrl, params.account.token);
        const result = await client.sendMessage(params.to, params.text);
        return { messageId: result.id };
      },
    },
  },
});

export { resolveAccount, getRestClient };
