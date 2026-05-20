/**
 * Cove channel plugin definition.
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { MsgContext } from "openclaw/plugin-sdk/reply-runtime";
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

  return {
    accountId: accountId ?? null,
    token,
    baseUrl,
    guildId: section?.guildId ?? "cove",
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
    chatTypes: ["direct"],
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
      console.log("[COVE OUTBOUND] sendText called, to:", ctx.to, "text length:", ctx.text?.length);
      const cfg = ctx.cfg;
      const account = resolveAccount(cfg);
      const client = getRestClient(account.baseUrl, account.token);
      const channelId = ctx.to ?? "home";
      const text = ctx.text ?? "";
      const result = await client.sendMessage(channelId, text);
      console.log("[COVE OUTBOUND] message sent, id:", result.id);
      return { channel: "cove", messageId: result.id };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const cfg = ctx.cfg;
      const log = ctx.log;
      const channelRuntime = (ctx as any).channelRuntime;

      log?.info?.(`cove: channelRuntime available: ${!!channelRuntime}`);
      if (channelRuntime) {
        log?.info?.(`cove: channelRuntime keys: ${Object.keys(channelRuntime).join(", ")}`);
        if (channelRuntime.reply) {
          log?.info?.(`cove: channelRuntime.reply keys: ${Object.keys(channelRuntime.reply).join(", ")}`);
        }
      }

      const wsUrl = account.baseUrl.replace(/^http/, "ws") + "/gateway";
      log?.info?.(`cove: connecting to gateway at ${wsUrl}`);

      const gatewayClient = new CoveGatewayClient({
        url: wsUrl,
        token: account.token,
      });

      gatewayClient.on("ready", (user) => {
        log?.info?.(`cove: connected to gateway as ${user.username} (${user.id})`);
        ctx.setStatus({
          accountId: ctx.accountId,
          connected: true,
          running: true,
          configured: true,
          enabled: true,
        });
      });

      gatewayClient.on("messageCreate", async (message) => {
        if (gatewayClient.botUser && message.author.id === gatewayClient.botUser.id) return;
        if (message.author.bot) return;

        log?.info?.(`cove: inbound message from ${message.author.username} in ${message.channel_id}`);

        try {
          const restClient = getRestClient(account.baseUrl, account.token);

          if (channelRuntime?.reply?.dispatchReplyWithBufferedBlockDispatcher) {
            // Use the full runtime pipeline - this handles routing, session, and delivery
            log?.info?.("cove: using channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher");

            const { dispatchInboundDirectDmWithRuntime } = await loadDirectDm();

            await dispatchInboundDirectDmWithRuntime({
              cfg,
              runtime: { channel: channelRuntime },
              channel: "cove",
              channelLabel: "Cove",
              accountId: ctx.accountId,
              peer: { kind: "direct", id: message.author.id },
              senderId: message.author.id,
              senderAddress: message.author.id,
              recipientAddress: message.channel_id,
              conversationLabel: message.author.username,
              rawBody: message.content,
              messageId: message.id ?? `cove-${Date.now()}`,
              timestamp: Date.now(),
              deliver: async (payload) => {
                const text = payload.text ?? "";
                log?.info?.(`cove: delivering reply (${text.length} chars) to ${message.channel_id}`);
                if (text) {
                  await restClient.sendMessage(message.channel_id, text);
                  log?.info?.("cove: reply delivered successfully");
                }
              },
              onRecordError: (err) => {
                log?.error?.(`cove: record error: ${err}`);
              },
              onDispatchError: (err, info) => {
                log?.error?.(`cove: dispatch error (${info.kind}): ${err}`);
              },
            });
          } else {
            // Fallback: use dispatchInboundMessageWithDispatcher
            log?.info?.("cove: channelRuntime not available, using fallback dispatcher");
            const { dispatchInboundMessageWithDispatcher } = await import("openclaw/plugin-sdk/reply-runtime");

            const msgCtx: MsgContext = {
              Body: message.content,
              From: message.author.id,
              To: message.channel_id,
              SessionKey: `agent:kagura:cove:direct:${message.author.id}`,
              AccountId: ctx.accountId,
              InboundEventKind: "user_request",
            };

            await dispatchInboundMessageWithDispatcher({
              ctx: msgCtx,
              cfg,
              dispatcherOptions: {
                deliver: async (payload) => {
                  const text = (payload as any).text ?? "";
                  if (text) {
                    await restClient.sendMessage(message.channel_id, text);
                  }
                },
              },
            });
          }
        } catch (err: any) {
          log?.error?.(`cove: dispatch error: ${err.message}\n${err.stack}`);
        }
      });

      gatewayClient.on("error", (err) => {
        log?.error?.(`cove: gateway error: ${err.message}`);
      });

      gatewayClient.on("close", () => {
        log?.info?.("cove: gateway connection closed, will reconnect...");
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
