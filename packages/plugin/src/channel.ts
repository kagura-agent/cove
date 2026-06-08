/**
 * Cove channel plugin definition.
 *
 * Each Cove channel (home, garden, beach, etc.) maps to a separate OpenClaw
 * session. Messages in different channels go to different agent sessions.
 *
 * This module is the orchestrator — it wires up the gateway client, handles
 * events, and delegates message dispatch to the dispatch module.
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { CoveAccount } from "./types.js";
import { CoveRestClient } from "./rest-client.js";
import { CoveGatewayClient } from "./gateway-client.js";
import { dispatchMessage } from "./dispatch.js";


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

// Re-export for test compatibility
export { createAbortableDispatch, DispatchTimeoutError, DispatchAbortedError } from "./dispatch.js";

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
    guildId: section?.guildId ?? null,
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

      /** Track in-flight dispatches per channel so we can cancel on reconnect or duplicate. */
      const pendingDispatches = new Map<string, AbortController>();
      const restClient = getRestClient(account.baseUrl, account.token);

      gatewayClient.on("reconnect", () => {
        // Hard reconnect (IDENTIFY fallback after failed RESUME) — abort pending dispatches and clear stale state
        log?.info?.(`cove: hard reconnect — aborting ${pendingDispatches.size} pending dispatch(es)`);
        for (const controller of pendingDispatches.values()) {
          controller.abort();
        }
        pendingDispatches.clear();

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
        if (message.author.bot) return;

        log?.info?.(`cove: [${message.channel_id}] ${message.author.username}: ${message.content.slice(0, 50)}`);

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
      });

      gatewayClient.on("error", (err) => {
        log?.error?.(`cove: gateway error: ${err.message}`);
      });

      gatewayClient.on("close", () => {
        log?.info?.("cove: gateway disconnected, will reconnect...");
      });

      ctx.abortSignal.addEventListener("abort", () => {
        // Abort all pending dispatches on plugin shutdown
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
};

export { coveChannelPlugin, resolveAccount, getRestClient };
