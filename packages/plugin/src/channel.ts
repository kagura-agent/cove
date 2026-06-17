/**
 * Cove channel plugin definition.
 *
 * Each Cove channel (home, garden, beach, etc.) maps to a separate OpenClaw
 * session. Messages in different channels go to different agent sessions.
 *
 * This module is the orchestrator — it wires up the gateway client, handles
 * events, and delegates message dispatch to the dispatch module.
 */

import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { chunkTextForOutbound } from "openclaw/plugin-sdk/text-chunking";
import { createChannelMessageAdapterFromOutbound } from "openclaw/plugin-sdk/channel-outbound";
import type { CoveAccount } from "./types.js";
import { CoveRestClient } from "./rest-client.js";
import { CoveGatewayClient } from "./gateway-client.js";
import { dispatchMessage } from "./dispatch.js";
import { ChannelMessageQueue } from "./message-queue.js";
import { invalidateCoveMd } from "./cove-md-cache.js";
import { resolveTargetsWithOptionalToken } from "openclaw/plugin-sdk/target-resolver-runtime";
import { createAccountListHelpers, resolveMergedAccountConfig } from "openclaw/plugin-sdk/account-resolution";

const { listAccountIds: listCoveAccountIds, resolveDefaultAccountId: resolveDefaultCoveAccountId } = createAccountListHelpers("cove");

/**
 * Bounded LRU-style set to track message IDs sent by the bot.
 * Used to determine "own" messages for reaction notifications.
 */
class SentMessageTracker {
  private readonly ids = new Set<string>();
  private readonly maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  add(id: string): void {
    if (this.ids.has(id)) {
      this.ids.delete(id); // refresh recency
    } else if (this.ids.size >= this.maxSize) {
      // Remove oldest entry (first inserted)
      const oldest = this.ids.values().next().value;
      this.ids.delete(oldest!);
    }
    this.ids.add(id);
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }
}

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

function resolveAccount(cfg: any, accountId?: string | null): CoveAccount {
  const channelConfig = cfg.channels?.["cove"];
  const effectiveAccountId = accountId ?? resolveDefaultCoveAccountId(cfg) ?? undefined;
  const merged = resolveMergedAccountConfig({ channelConfig, accounts: channelConfig?.accounts, accountId: (effectiveAccountId ?? undefined) as string });
  const token = merged?.token;
  if (!token) throw new Error(`cove: account '${effectiveAccountId ?? "default"}' missing token — set channels.cove.accounts.<id>.token`);
  const agentId = merged?.agentId;
  if (!agentId) throw new Error(`cove: account '${effectiveAccountId ?? "default"}' missing agentId — set channels.cove.accounts.<id>.agentId`);
  return { accountId: accountId ?? null, token, baseUrl: merged?.baseUrl ?? "http://localhost:3400", guildId: merged?.guildId ?? null, agentId, agentName: merged?.agentName ?? agentId, allowFrom: merged?.allowFrom ?? [], dmPolicy: merged?.dmSecurity };
}

/**
 * Cove outbound adapter — mirrors Discord's pattern.
 * Declares chunker + textChunkLimit so SDK auto-chunks delivery.
 */
const COVE_TEXT_CHUNK_LIMIT = 4000;

const coveOutbound = {
  deliveryMode: "direct" as const,
  chunker: chunkTextForOutbound,
  chunkerMode: "markdown" as const,
  textChunkLimit: COVE_TEXT_CHUNK_LIMIT,
  deliveryCapabilities: { durableFinal: {
    text: true,
    media: false,
    messageSendingHooks: true,
  } },
  sendText: async (ctx: any) => {
    const account = resolveAccount(ctx.cfg, ctx.accountId);
    const client = getRestClient(account.baseUrl, account.token);
    const channelId = ctx.to ?? "home";
    const text = ctx.text ?? "";
    const result = await client.sendMessage(channelId, text);
    return { channel: "cove", messageId: result.id };
  },
};

const coveMessageAdapter = createChannelMessageAdapterFromOutbound({
  id: "cove",
  outbound: coveOutbound,
  live: {
    capabilities: {
      draftPreview: true,
      previewFinalization: true,
      progressUpdates: true,
    },
    finalizer: { capabilities: {
      finalEdit: true,
      normalFallback: true,
    } },
  },
});

const coveChannelPlugin = createChatChannelPlugin({
  base: {
    id: "cove" as any,
    meta: {
      id: "cove" as any,
      label: "Cove",
      selectionLabel: "Cove",
      docsPath: "",
      blurb: "Mirror world channel",
    },
    capabilities: {
      chatTypes: ["direct", "channel"],
    },
    config: {
      listAccountIds: listCoveAccountIds,
      resolveAccount: (cfg: any, accountId?: string | null) => resolveAccount(cfg, accountId),
      defaultAccountId: resolveDefaultCoveAccountId,
    },
    setup: {
      resolveAccountId: (params) => resolveDefaultCoveAccountId(params.cfg),
      applyAccountConfig: ({ cfg }) => cfg,
    },
    resolver: {
      resolveTargets: async ({ cfg, accountId, inputs, kind }) => {
        let account: CoveAccount | undefined;
        let resolveError: string | undefined;
        try {
          account = resolveAccount(cfg, accountId);
        } catch (err) {
          resolveError = err instanceof Error ? err.message : String(err);
        }

        if (kind === "group") {
          return resolveTargetsWithOptionalToken({
            token: account?.token,
            inputs,
            missingTokenNote: resolveError ?? "missing Cove bot token",
            resolveWithToken: async ({ token, inputs: inputsValue }): Promise<Array<{ input: string; resolved: boolean; channelId?: string; channelName?: string; guildId?: string | null; note?: string }>> => {
              if (!account!.guildId) {
                return inputsValue.map((input) => ({
                  input,
                  resolved: false,
                  note: "guildId not configured",
                }));
              }

              const accountBaseUrl = account!.baseUrl;
              const accountGuildId = account!.guildId!;

              const restClient = getRestClient(accountBaseUrl, token);
              let channels;
              try {
                channels = await restClient.getChannels(accountGuildId);
              } catch (err: any) {
                return inputsValue.map((input) => ({
                  input,
                  resolved: false,
                  note: `failed to fetch channels: ${err.message}`,
                }));
              }

              return inputsValue.map((input) => {
                const inputLower = input.toLowerCase();
                const match = channels.find(
                  (ch) => ch.id === input || ch.name.toLowerCase() === inputLower,
                );
                return {
                  input,
                  resolved: Boolean(match),
                  channelId: match?.id,
                  channelName: match?.name,
                  guildId: accountGuildId,
                  note: match ? undefined : "channel not found",
                };
              });
            },
            mapResolved: (entry) => ({
              input: entry.input,
              resolved: entry.resolved,
              id: entry.resolved ? entry.channelId : undefined,
              name: entry.resolved ? entry.channelName : undefined,
              note: entry.note,
            }),
          });
        }

        // User target resolution — not supported yet
        return resolveTargetsWithOptionalToken({
          token: account?.token,
          inputs,
          missingTokenNote: resolveError ?? "missing Cove bot token",
          resolveWithToken: async ({ inputs: inputsValue }) => {
            return inputsValue.map((input) => ({
              input,
              resolved: false,
              note: "user target resolution not supported",
            }));
          },
          mapResolved: (entry) => ({
            input: entry.input,
            resolved: entry.resolved,
            note: entry.note,
          }),
        });
      },
    },
    outbound: {
      deliveryMode: "direct",
      sendText: coveOutbound.sendText,
      chunker: coveOutbound.chunker,
      textChunkLimit: coveOutbound.textChunkLimit,
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

        /** Track in-flight dispatches per channel so we can cancel on reconnect or duplicate. */
        const pendingDispatches = new Map<string, AbortController>();
        const restClient = getRestClient(account.baseUrl, account.token);

        const messageQueue = new ChannelMessageQueue({
          dispatchFn: async (message) => {
            await dispatchMessage({
              message,
              account,
              restClient,
              channelRuntime,
              cfg,
              accountId: ctx.accountId,
              pendingDispatches,
              log,
            });
          },
          batchDispatchFn: async (messages) => {
            const primary = messages[messages.length - 1];
            const earlier = messages.slice(0, -1);
            await dispatchMessage({
              message: primary,
              batchedMessages: earlier,
              account,
              restClient,
              channelRuntime,
              cfg,
              accountId: ctx.accountId,
              pendingDispatches,
              log,
            });
          },
          log,
        });

        gatewayClient.on("reconnect", () => {
          // Hard reconnect (IDENTIFY fallback after failed RESUME) — abort pending dispatches and clear stale state
          log?.info?.(`cove: hard reconnect — aborting ${pendingDispatches.size} pending dispatch(es)`);
          for (const controller of pendingDispatches.values()) {
            controller.abort();
          }
          pendingDispatches.clear();
          messageQueue.clearAll();

          // Re-fetch channel list to pick up any changes during disconnection
          if (account.guildId) {
            restClient.getChannels(account.guildId).then((channels) => {
              // TODO: update channel cache when channel routing is implemented
              log?.info?.(`cove: reconnect recovery — fetched ${channels.length} channel(s)`);
            }).catch((err) => {
              log?.warn?.(`cove: reconnect channel refresh failed: ${err.message}`);
            });
          }
        });

        gatewayClient.on("resumed", () => {
          // Gateway session resumed — no state was lost, dispatches can continue
          log?.info?.("cove: gateway session resumed");
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

        // Track messages sent by the bot for reaction notifications
        const sentMessages = new SentMessageTracker();

        // Resolve reaction notification mode from config
        const channelSection = cfg?.channels?.["cove"] ?? {};
        const reactionNotifications: "off" | "own" | "all" = (channelSection as any).reactionNotifications ?? "own";

        gatewayClient.on("messageReactionAdd", async (payload) => {
          log?.info?.(`cove: reaction event received — user=${payload.user_id} msg=${payload.message_id} emoji=${payload.emoji.name} tracked=${sentMessages.has(payload.message_id)} mode=${reactionNotifications}`);
          if (reactionNotifications === "off") return;
          // Don't notify when the bot itself reacts
          if (gatewayClient.botUser && payload.user_id === gatewayClient.botUser.id) return;
          // In "own" mode, only notify for reactions to bot's own messages
          if (reactionNotifications === "own" && !sentMessages.has(payload.message_id)) {
            // REST fallback: check if message was sent by bot
            try {
              const msg = await restClient.getMessage(payload.channel_id, payload.message_id);
              if (!msg || msg.author.id !== gatewayClient.botUser?.id) return;
              sentMessages.add(payload.message_id); // cache for next time
            } catch { return; }
          }

          const emoji = payload.emoji.name;
          const userId = payload.user_id;
          const channelId = payload.channel_id;

          // Resolve display names for the notification text
          let username = userId;
          let channelName = channelId;
          try {
            const user = await restClient.getUser(userId);
            username = user.username;
          } catch { /* fall back to ID */ }
          try {
            const channel = await restClient.getChannel(channelId);
            channelName = channel.name;
          } catch { /* fall back to ID */ }

          const text = `${username} reacted with ${emoji} to your message in #${channelName}`;
          const sessionKey = `agent:${account.agentId}:cove:group:${channelId}`;

          try {
            const { enqueueSystemEvent } = await import("openclaw/plugin-sdk/system-event-runtime");
            enqueueSystemEvent(text, { sessionKey, contextKey: "cove-reaction" });
            log?.info?.(`cove: reaction notification enqueued — ${text}`);
          } catch (err: any) {
            log?.warn?.(`cove: failed to enqueue reaction system event: ${err.message}`);
          }
        });

        gatewayClient.on("messageCreate", async (message) => {
          // Track messages sent by the bot
          if (gatewayClient.botUser && message.author.id === gatewayClient.botUser.id) {
            sentMessages.add(message.id);
            return;
          }
          // Skip bot messages from others
          if (message.author.bot && !message.webhook_id) return;

          log?.info?.(`cove: [${message.channel_id}] ${message.author.global_name || message.author.username}: ${message.content.slice(0, 50)}`);

          messageQueue.enqueue(message);
        });

        gatewayClient.on("error", (err) => {
          log?.error?.(`cove: gateway error: ${err.message}`);
        });

        gatewayClient.on("close", () => {
          log?.info?.("cove: gateway disconnected, will reconnect...");
        });

        // Invalidate cove.md cache when file events affect cove.md
        gatewayClient.on("channelFileCreate", (payload) => {
          if (payload.filename === "cove.md") invalidateCoveMd(payload.channel_id);
        });
        gatewayClient.on("channelFileUpdate", (payload) => {
          if (payload.filename === "cove.md") invalidateCoveMd(payload.channel_id);
        });
        gatewayClient.on("channelFileDelete", (payload) => {
          if (payload.filename === "cove.md") invalidateCoveMd(payload.channel_id);
        });

        ctx.abortSignal.addEventListener("abort", () => {
          // Clear queued messages and abort all pending dispatches on plugin shutdown
          messageQueue.clearAll();
          for (const c of pendingDispatches.values()) c.abort();
          pendingDispatches.clear();
          gatewayClient.destroy();
        });

        gatewayClient.connect();

        return new Promise<void>((resolve) => {
          ctx.abortSignal.addEventListener("abort", () => resolve());
        });
      },
    },
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
});

export { coveChannelPlugin, resolveAccount, getRestClient };
