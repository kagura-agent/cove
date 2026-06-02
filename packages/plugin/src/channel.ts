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
import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-message";
import { createFinalizableDraftLifecycle } from "openclaw/plugin-sdk/channel-lifecycle";
import { createToolProgressTracker } from "./tool-progress.js";

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

        // Fire-and-forget early typing cue via WebSocket (instant, no TLS overhead)
        gatewayClient.send({ op: 4, d: { channel_id: channelId } });

        const typingCallbacks = createTypingCallbacks({
          start: () => {
            gatewayClient.send({ op: 4, d: { channel_id: channelId } });
            return Promise.resolve();
          },
          keepaliveIntervalMs: 5000,
          maxDurationMs: 60000,
          onStartError: (err) => log?.warn?.(`cove: typing start error in [${channelId}]: ${err}`),
        });

        try {
          const restClient = getRestClient(account.baseUrl, account.token);
          const { dispatchInboundDirectDmWithRuntime } = await loadDirectDm();

          const targetAgent = account.agentId;
          const originalRouting = channelRuntime.routing;
          const originalDispatcher = channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher;

          const draftState = { stopped: false, final: false };
          let draftMessageId: string | undefined;
          let lastSentText = "";
          const toolProgress = createToolProgressTracker(undefined, {
            seed: message.id ?? String(Date.now()),
            onProgressUpdate: () => {
              const combined = toolProgress.getCombinedText();
              if (combined) draft.update(combined);
            },
          });

          const sendOrEdit = async (text: string) => {
            if (draftState.stopped && !draftState.final) return false;
            const trimmed = text.trimEnd();
            if (!trimmed || trimmed === lastSentText) return false;
            lastSentText = trimmed;
            try {
              if (draftMessageId) {
                await restClient.editMessage(channelId, draftMessageId, trimmed);
              } else {
                const msg = await restClient.sendMessage(channelId, trimmed);
                draftMessageId = msg.id;
              }
              return true;
            } catch (err: any) {
              draftState.stopped = true;
              log?.warn?.(`cove: stream preview failed: ${err.message}`);
              return false;
            }
          };

          const draft = createFinalizableDraftLifecycle({
            throttleMs: 250,
            state: draftState,
            sendOrEditStreamMessage: sendOrEdit,
            readMessageId: () => draftMessageId,
            clearMessageId: () => { draftMessageId = undefined; },
            isValidMessageId: (v: unknown) => typeof v === "string",
            deleteMessage: async () => {},
            warnPrefix: "cove",
          });

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
              reply: {
                ...channelRuntime.reply,
                dispatchReplyWithBufferedBlockDispatcher: (params: any) =>
                  originalDispatcher({
                    ...params,
                    dispatcherOptions: {
                      ...params.dispatcherOptions,
                      typingCallbacks,
                      deliver: async (payload: any, _info: { kind: string }) => {
                        typingCallbacks.onCleanup?.();
                        const text = payload.text ?? "";
                        if (!text) return;

                        draftState.final = true;
                        await draft.seal();

                        if (draftMessageId) {
                          log?.info?.(`cove: stream final → [${channelId}] (${text.length} chars)`);
                          await restClient.editMessage(channelId, draftMessageId, text);
                        } else {
                          log?.info?.(`cove: reply → [${channelId}] (${text.length} chars)`);
                          await restClient.sendMessage(channelId, text);
                        }
                      },
                    },
                    replyOptions: {
                      ...params.replyOptions,
                      disableBlockStreaming: true,
                      suppressDefaultToolProgressMessages: true,
                      onPartialReply: (payload: any) => {
                        if (payload?.text) {
                          toolProgress.onPartialReply(payload.text);
                          draft.update(payload.text);
                        }
                      },
                      onToolStart: (payload: any) => {
                        toolProgress.onToolStart({
                          name: payload?.name ?? payload?.toolName,
                          args: payload?.args,
                          phase: payload?.phase,
                          detailMode: payload?.detailMode,
                        });
                      },
                      onItemEvent: (payload: any) => {
                        toolProgress.onItemEvent(payload);
                      },
                      onPlanUpdate: (payload: any) => {
                        toolProgress.onPlanUpdate(payload);
                      },
                      onApprovalEvent: (payload: any) => {
                        toolProgress.onApprovalEvent(payload);
                      },
                      onCommandOutput: (payload: any) => {
                        toolProgress.onCommandOutput(payload);
                      },
                      onPatchSummary: (payload: any) => {
                        toolProgress.onPatchSummary(payload);
                      },
                      onCompactionStart: () => {
                        toolProgress.onCompactionStart();
                        const combined = toolProgress.getCombinedText();
                        if (combined) draft.update(combined);
                      },
                      onCompactionEnd: () => {
                        toolProgress.onCompactionEnd();
                      },
                      onAssistantMessageStart: () => {
                        toolProgress.onAssistantMessageStart();
                      },
                    },
                  }),
              },
            },
          };

          // Yield event loop so WS typing frame flushes before heavy bootstrap work
          await new Promise<void>((resolve) => setTimeout(resolve, 1));

          await dispatchInboundDirectDmWithRuntime({
            cfg,
            runtime: patchedRuntime as any,
            channel: "cove",
            channelLabel: "Cove",
            accountId: ctx.accountId,
            peer: { kind: "group" as any, id: channelId },
            senderId,
            senderAddress: senderId,
            recipientAddress: channelId,
            conversationLabel: `#${channelId}`,
            rawBody: message.content,
            bodyForAgent: message.content,
            messageId: message.id ?? `cove-${Date.now()}`,
            timestamp: message.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
            provider: "cove",
            surface: "cove",
            extraContext: {
              ChatType: "channel",
              SenderId: senderId,
              SenderName: senderName,
              ChannelId: channelId,
            },
            deliver: async (_payload) => {
              // Delivery is handled by the dispatcher's deliver callback above
              // (block streaming sends/edits messages directly).
            },
            onRecordError: (err) => {
              log?.error?.(`cove: record error in [${channelId}]: ${err}`);
            },
            onDispatchError: (err, info) => {
              log?.error?.(`cove: dispatch error (${info.kind}) in [${channelId}]: ${err}`);
            },
          });
        } catch (err: any) {
          typingCallbacks.onCleanup?.();
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
