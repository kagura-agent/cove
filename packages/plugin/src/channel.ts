/**
 * Cove channel plugin definition.
 *
 * Registers Cove as an OpenClaw channel using the plugin SDK.
 * Handles account resolution, DM security, and outbound messaging.
 */

import {
  createChatChannelPlugin,
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
  base: {
    id: "cove",
    meta: {
      id: "cove",
      label: "Cove",
      selectionLabel: "Cove",
      docsPath: "/docs/channels/cove",
      blurb: "Connect OpenClaw to the Cove mirror world",
    },
    capabilities: {
      chatTypes: ["direct", "group"],
    },
    config: {
      listAccountIds: (_cfg: OpenClawConfig) => ["default"],
      resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) =>
        resolveAccount(cfg, accountId),
    },
    setup: {
      applyAccountConfig: (params: {
        cfg: OpenClawConfig;
        accountId: string;
        input: Record<string, unknown>;
      }) => {
        // Apply input fields to config
        const cfg = structuredClone(params.cfg) as any;
        if (!cfg.channels) cfg.channels = {};
        if (!cfg.channels.cove) cfg.channels.cove = {};
        if (params.input.token) cfg.channels.cove.token = params.input.token;
        if (params.input.baseUrl) cfg.channels.cove.baseUrl = params.input.baseUrl;
        return cfg as OpenClawConfig;
      },
    },
  },

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
    base: {
      deliveryMode: "direct" as const,
    },
    attachedResults: {
      channel: "cove",
      sendText: async (ctx) => {
        // Resolve the account from config to get REST client credentials
        const account = resolveAccount(ctx.cfg);
        const client = getRestClient(account.baseUrl, account.token);
        const result = await client.sendMessage(ctx.to, ctx.text);
        return { messageId: result.id };
      },
    },
  },
});

export { resolveAccount, getRestClient };
