/** Cove channel plugin — createChatChannelPlugin shell with outbound + message adapter. */
import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { createChannelMessageAdapterFromOutbound } from "openclaw/plugin-sdk/channel-message";
import { type CoveAccount, COVE_TEXT_CHUNK_LIMIT } from "./types.js";
import { CoveRestClient } from "./rest-client.js";
import { CoveGatewayClient } from "./gateway-client.js";
import { dispatchMessage } from "./dispatch.js";
import { ChannelMessageQueue } from "./message-queue.js";
import { invalidateCoveMd } from "./cove-md-cache.js";
import { resolveTargetsWithOptionalToken } from "openclaw/plugin-sdk/target-resolver-runtime";
import { createAccountListHelpers, resolveMergedAccountConfig } from "openclaw/plugin-sdk/account-resolution";

const { listAccountIds: listCoveAccountIds, resolveDefaultAccountId: resolveDefaultCoveAccountId } = createAccountListHelpers("cove");

/** Bounded LRU set tracking message IDs sent by the bot (for reaction filtering). */
class SentMessageTracker {
  private readonly ids = new Set<string>();
  constructor(private readonly maxSize = 500) {}
  add(id: string): void {
    if (this.ids.has(id)) this.ids.delete(id);
    else if (this.ids.size >= this.maxSize) { this.ids.delete(this.ids.values().next().value!); }
    this.ids.add(id);
  }
  has(id: string): boolean { return this.ids.has(id); }
}

const restClients = new Map<string, CoveRestClient>();

function getRestClient(baseUrl: string, token: string): CoveRestClient {
  const key = `${baseUrl}::${token}`;
  let client = restClients.get(key);
  if (!client) { client = new CoveRestClient(baseUrl, token); restClients.set(key, client); }
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

async function coveSendText(ctx: any): Promise<{ messageId: string }> {
  const account = resolveAccount(ctx.cfg, ctx.accountId);
  const client = getRestClient(account.baseUrl, account.token);
  const result = await client.sendMessage(ctx.to ?? "home", ctx.text ?? "");
  return { messageId: result.id };
}

const coveOutbound = {
  base: { deliveryMode: "direct" as const, textChunkLimit: COVE_TEXT_CHUNK_LIMIT, chunkerMode: "markdown" as const },
  attachedResults: { channel: "cove", sendText: coveSendText },
};

const coveMessageAdapter = createChannelMessageAdapterFromOutbound({
  id: "cove",
  outbound: { sendText: async (ctx: any) => coveSendText(ctx) },
});

const coveChannelPlugin = createChatChannelPlugin<CoveAccount>({
  base: {
    id: "cove" as any,
    meta: { id: "cove" as any, label: "Cove", selectionLabel: "Cove", docsPath: "", blurb: "Mirror world channel" },
    capabilities: { chatTypes: ["direct", "channel"] },
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
        try { account = resolveAccount(cfg, accountId); }
        catch (err) { resolveError = err instanceof Error ? err.message : String(err); }
        if (kind === "group") {
          return resolveTargetsWithOptionalToken({
            token: account?.token, inputs,
            missingTokenNote: resolveError ?? "missing Cove bot token",
            resolveWithToken: async ({ token, inputs: iv }): Promise<Array<{ input: string; resolved: boolean; channelId?: string; channelName?: string; guildId?: string | null; note?: string }>> => {
              if (!account!.guildId) return iv.map((input) => ({ input, resolved: false, note: "guildId not configured" }));
              const restClient = getRestClient(account!.baseUrl, token);
              let channels;
              try { channels = await restClient.getChannels(account!.guildId!); }
              catch (err: any) { return iv.map((input) => ({ input, resolved: false, note: `failed to fetch channels: ${err.message}` })); }
              return iv.map((input) => {
                const match = channels.find((ch) => ch.id === input || ch.name.toLowerCase() === input.toLowerCase());
                return { input, resolved: Boolean(match), channelId: match?.id, channelName: match?.name, guildId: account!.guildId!, note: match ? undefined : "channel not found" };
              });
            },
            mapResolved: (e) => ({ input: e.input, resolved: e.resolved, id: e.resolved ? e.channelId : undefined, name: e.resolved ? e.channelName : undefined, note: e.note }),
          });
        }
        return resolveTargetsWithOptionalToken({
          token: account?.token, inputs,
          missingTokenNote: resolveError ?? "missing Cove bot token",
          resolveWithToken: async ({ inputs: iv }) => iv.map((input) => ({ input, resolved: false, note: "user target resolution not supported" })),
          mapResolved: (e) => ({ input: e.input, resolved: e.resolved, note: e.note }),
        });
      },
    },
    message: coveMessageAdapter,
    gateway: {
      startAccount: async (ctx) => {
        const { account, cfg, log } = ctx;
        const channelRuntime = (ctx as any).channelRuntime;
        if (!channelRuntime) { log?.warn?.("cove: channelRuntime not available — AI features disabled"); return; }

        const wsUrl = account.baseUrl.replace(/^http/, "ws") + "/gateway";
        log?.info?.(`cove: connecting to gateway at ${wsUrl}`);
        const gatewayClient = new CoveGatewayClient({ url: wsUrl, token: account.token });
        const pendingDispatches = new Map<string, AbortController>();
        const restClient = getRestClient(account.baseUrl, account.token);

        const doDispatch = (message: any, batchedMessages?: any[]) =>
          dispatchMessage({ message, batchedMessages, account, restClient, channelRuntime, cfg, accountId: ctx.accountId, pendingDispatches, log });
        const messageQueue = new ChannelMessageQueue({
          dispatchFn: (message) => doDispatch(message),
          batchDispatchFn: (messages) => doDispatch(messages[messages.length - 1], messages.slice(0, -1)),
          log,
        });

        gatewayClient.on("reconnect", () => {
          log?.info?.(`cove: hard reconnect — aborting ${pendingDispatches.size} pending dispatch(es)`);
          for (const c of pendingDispatches.values()) c.abort();
          pendingDispatches.clear();
          messageQueue.clearAll();
          if (account.guildId) {
            restClient.getChannels(account.guildId)
              .then((ch) => log?.info?.(`cove: reconnect recovery — fetched ${ch.length} channel(s)`))
              .catch((err) => log?.warn?.(`cove: reconnect channel refresh failed: ${err.message}`));
          }
        });
        gatewayClient.on("resumed", () => log?.info?.("cove: gateway session resumed"));
        gatewayClient.on("ready", (user) => {
          log?.info?.(`cove: connected as ${user.username} (${user.id})`);
          ctx.setStatus({ accountId: ctx.accountId, connected: true, running: true, configured: true, enabled: true });
        });

        const sentMessages = new SentMessageTracker();
        const reactionNotifications: "off" | "own" | "all" = ((cfg?.channels?.["cove"] ?? {}) as any).reactionNotifications ?? "own";

        gatewayClient.on("messageReactionAdd", async (payload) => {
          log?.info?.(`cove: reaction event — user=${payload.user_id} msg=${payload.message_id} emoji=${payload.emoji.name} mode=${reactionNotifications}`);
          if (reactionNotifications === "off") return;
          if (gatewayClient.botUser && payload.user_id === gatewayClient.botUser.id) return;
          if (reactionNotifications === "own" && !sentMessages.has(payload.message_id)) {
            try {
              const msg = await restClient.getMessage(payload.channel_id, payload.message_id);
              if (!msg || msg.author.id !== gatewayClient.botUser?.id) return;
              sentMessages.add(payload.message_id);
            } catch { return; }
          }
          let username = payload.user_id, channelName = payload.channel_id;
          try { username = (await restClient.getUser(payload.user_id)).username; } catch {}
          try { channelName = (await restClient.getChannel(payload.channel_id)).name; } catch {}
          const text = `${username} reacted with ${payload.emoji.name} to your message in #${channelName}`;
          try {
            const { enqueueSystemEvent } = await import("openclaw/plugin-sdk/system-event-runtime");
            enqueueSystemEvent(text, { sessionKey: `agent:${account.agentId}:cove:group:${payload.channel_id}`, contextKey: "cove-reaction" });
            log?.info?.(`cove: reaction notification enqueued — ${text}`);
          } catch (err: any) { log?.warn?.(`cove: failed to enqueue reaction event: ${err.message}`); }
        });

        gatewayClient.on("messageCreate", async (message) => {
          if (gatewayClient.botUser && message.author.id === gatewayClient.botUser.id) { sentMessages.add(message.id); return; }
          if (message.author.bot && !message.webhook_id) return;
          log?.info?.(`cove: [${message.channel_id}] ${message.author.global_name || message.author.username}: ${message.content.slice(0, 50)}`);
          messageQueue.enqueue(message);
        });

        gatewayClient.on("error", (err) => log?.error?.(`cove: gateway error: ${err.message}`));
        gatewayClient.on("close", () => log?.info?.("cove: gateway disconnected, will reconnect..."));
        for (const ev of ["channelFileCreate", "channelFileUpdate", "channelFileDelete"] as const) {
          gatewayClient.on(ev, (p: any) => { if (p.filename === "cove.md") invalidateCoveMd(p.channel_id); });
        }

        ctx.abortSignal.addEventListener("abort", () => {
          messageQueue.clearAll();
          for (const c of pendingDispatches.values()) c.abort();
          pendingDispatches.clear();
          gatewayClient.destroy();
        });
        gatewayClient.connect();
        return new Promise<void>((resolve) => { ctx.abortSignal.addEventListener("abort", () => resolve()); });
      },
    },
  },
  security: {
    resolveDmPolicy: (ctx) => {
      const account = ctx.account as CoveAccount;
      return { policy: account.dmPolicy ?? "open", allowFrom: account.allowFrom, allowFromPath: "channels.cove.allowFrom", approveHint: "Add user to channels.cove.allowFrom" };
    },
  },
  outbound: coveOutbound,
});

export { coveChannelPlugin, resolveAccount, getRestClient };
