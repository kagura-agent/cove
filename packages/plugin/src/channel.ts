/**
 * Cove channel plugin definition.
 *
 * Each Cove scene (home, garden, beach, etc.) maps to a separate OpenClaw
 * session, just like Discord channels. Messages in different scenes go to
 * different agent sessions.
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { CoveAccount } from "./types.js";
import { CoveRestClient } from "./rest-client.js";
import { CoveGatewayClient } from "./gateway-client.js";

// Use dynamic import to access the direct-dm helper
const loadDirectDm = () => import("openclaw/plugin-sdk/channel-inbound");

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
  cfg: any,
  accountId?: string | null,
): CoveAccount {
  const section = cfg.channels?.["cove"];
  const token = section?.token ?? process.env["COVE_BOT_TOKEN"] ?? "";
  const baseUrl = section?.baseUrl ?? process.env["COVE_BASE_URL"] ?? "http://localhost:3400";

  if (!token) {
    throw new Error("cove: bot token is required (set channels.cove.token or COVE_BOT_TOKEN env)");
  }

  const agentId = section?.agentId ?? process.env["COVE_AGENT_ID"] ?? "";
  const agentName = section?.agentName ?? process.env["COVE_AGENT_NAME"] ?? "";

  if (!agentId) {
    throw new Error("cove: agent ID is required (set channels.cove.agentId or COVE_AGENT_ID env)");
  }

  return {
    accountId: accountId ?? null,
    token,
    baseUrl,
    guildId: section?.guildId ?? "cove",
    agentId,
    agentName: agentName || agentId,
    allowFrom: section?.allowFrom ?? [],
    dmPolicy: section?.dmSecurity,
  };
}

const coveChannelPlugin: ChannelPlugin<CoveAccount> = {
  id: "cove" as any,
  meta: {
    id: "cove" as any,
    label: "Cove",
    selectionLabel: "Cove",
    docsPath: "",
    blurb: "Mirror world channel",
  },
  capabilities: {
    // Support both channel (scene) and direct messages
    chatTypes: ["direct", "channel"],
  },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: (cfg: any, accountId?: string | null) => resolveAccount(cfg, accountId),
  },
  setup: {
    resolveAccountId: () => "default",
    applyAccountConfig: ({ cfg }) => cfg,
  },
  security: {
    resolveDmPolicy: (ctx) => {
      const account = ctx.account as CoveAccount;
      return {
        policy: account.dmPolicy ?? "open",
        allowFrom: account.allowFrom,
        allowFromPath: "channels.cove.allowFrom",
        approveHint: "Add user to channels.cove.allowFrom",
      };
    },
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async (ctx) => {
      const cfg = ctx.cfg;
      const account = resolveAccount(cfg);
      const client = getRestClient(account.baseUrl, account.token);
      const channelId = ctx.to ?? "home";
      const text = ctx.text ?? "";
      const result = await client.sendMessage(channelId, text);
      return { channel: "cove", messageId: result.id };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const cfg = ctx.cfg;
      const log = ctx.log;
      const channelRuntime = (ctx as any).channelRuntime;

      if (!channelRuntime) {
        log?.warn?.("cove: channelRuntime not available — AI features disabled");
        return;
      }

      const wsUrl = account.baseUrl.replace(/^http/, "ws") + "/gateway";
      log?.info?.(`cove: connecting to gateway at ${wsUrl}`);

      const gatewayClient = new CoveGatewayClient({
        url: wsUrl,
        token: account.token,
      });

      gatewayClient.on("ready", (user) => {
        log?.info?.(`cove: connected as ${user.username} (${user.id})`);
        ctx.setStatus({
          accountId: ctx.accountId,
          connected: true,
          running: true,
          configured: true,
          enabled: true,
        });
      });

      gatewayClient.on("messageCreate", async (message) => {
        // Skip own messages and bot messages
        if (gatewayClient.botUser && message.author.id === gatewayClient.botUser.id) return;
        if (message.author.bot) return;

        const channelId = message.channel_id;
        const senderId = message.author.id;
        const senderName = message.author.username;

        log?.info?.(`cove: [${channelId}] ${senderName}: ${message.content.slice(0, 50)}`);

        try {
          const restClient = getRestClient(account.baseUrl, account.token);
          const { dispatchInboundDirectDmWithRuntime } = await loadDirectDm();

          // Override agent routing to target the configured agent
          const targetAgent = account.agentId;
          const originalRouting = channelRuntime.routing;
          const patchedRuntime = {
            channel: {
              ...channelRuntime,
              routing: {
                ...originalRouting,
                resolveAgentRoute: (params: any) => {
                  const route = originalRouting.resolveAgentRoute(params);
                  return { ...route, agentId: targetAgent, sessionKey: route.sessionKey.replace(/^agent:[^:]+:/, `agent:${targetAgent}:`) };
                },
              },
            },
          };

          // Route as group/channel — each scene gets its own OpenClaw session
          // Session key will be like: agent:kagura:cove:channel:home
          await dispatchInboundDirectDmWithRuntime({
            cfg,
            runtime: patchedRuntime as any,
            channel: "cove",
            channelLabel: "Cove",
            accountId: ctx.accountId,
            // Group peer = channel-based session (like Discord channels)
            peer: { kind: "group" as any, id: channelId },
            senderId,
            senderAddress: senderId,
            recipientAddress: channelId,
            conversationLabel: `#${channelId}`,
            rawBody: message.content,
            bodyForAgent: message.content,
            messageId: message.id ?? `cove-${Date.now()}`,
            timestamp: Date.now(),
            provider: "cove",
            surface: "cove",
            extraContext: {
              ChatType: "channel",
              SenderId: senderId,
              SenderName: senderName,
              ChannelId: channelId,
            },
            deliver: async (payload) => {
              const text = payload.text ?? "";
              if (text) {
                log?.info?.(`cove: reply → [${channelId}] (${text.length} chars)`);
                await restClient.sendMessage(channelId, text);
              }
            },
            onRecordError: (err) => {
              log?.error?.(`cove: record error in [${channelId}]: ${err}`);
            },
            onDispatchError: (err, info) => {
              log?.error?.(`cove: dispatch error (${info.kind}) in [${channelId}]: ${err}`);
            },
          });
        } catch (err: any) {
          log?.error?.(`cove: error in [${channelId}]: ${err.message}`);
        }
      });

      gatewayClient.on("error", (err) => {
        log?.error?.(`cove: gateway error: ${err.message}`);
      });

      gatewayClient.on("close", () => {
        log?.info?.("cove: gateway disconnected, will reconnect...");
      });

      ctx.abortSignal.addEventListener("abort", () => {
        gatewayClient.destroy();
      });

      gatewayClient.connect();

      return new Promise<void>((resolve) => {
        ctx.abortSignal.addEventListener("abort", () => resolve());
      });
    },
  },
};

export { coveChannelPlugin, resolveAccount, getRestClient };
