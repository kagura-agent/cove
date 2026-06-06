/**
 * Cove channel plugin definition.
 *
 * Each Cove channel (home, garden, beach, etc.) maps to a separate OpenClaw
 * session. Messages in different channels go to different agent sessions.
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { CoveAccount } from "./types.js";
import { CoveRestClient } from "./rest-client.js";
import { CoveGatewayClient } from "./gateway-client.js";
import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-message";
import { createFinalizableDraftLifecycle } from "openclaw/plugin-sdk/channel-lifecycle";
import { createToolProgressTracker } from "./tool-progress.js";

const DEFAULT_DISPATCH_TIMEOUT_MS = 120_000;

// Use dynamic import to access the direct-dm helper
const loadDirectDm = () => import("openclaw/plugin-sdk/channel-inbound");

export class DispatchTimeoutError extends Error {
  constructor() { super('dispatch timeout'); this.name = 'DispatchTimeoutError'; }
}
export class DispatchAbortedError extends Error {
  constructor() { super('dispatch aborted'); this.name = 'DispatchAbortedError'; }
}

/**
 * Race a dispatch promise against a timeout and an AbortSignal.
 * Resolves/rejects as soon as any of the three fires.
 *
 * Note: this is release-only, not cancellation — the underlying dispatch
 * continues running but side effects (message delivery, streaming edits,
 * typing indicators) are guarded by per-channel AbortController reference
 * equality so stale dispatches cannot send messages.
 */
export function createAbortableDispatch(
  dispatch: Promise<unknown>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) { settled = true; fn(); }
    };

    const timer = setTimeout(
      () => settle(() => reject(new DispatchTimeoutError())),
      timeoutMs,
    );

    const onAbort = () => settle(() => {
      clearTimeout(timer);
      reject(new DispatchAbortedError());
    });

    if (signal.aborted) {
      clearTimeout(timer);
      dispatch.catch(() => {}); // Prevent unhandled rejection from orphaned dispatch
      reject(new DispatchAbortedError());
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });

    dispatch.then(
      () => settle(() => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); resolve(); }),
      (err) => settle(() => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); reject(err); }),
    );
  });
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

/**
 * Clean up an orphaned draft message and fall back to sending a fresh
 * message.  Reused by both the streaming-error path and the final-edit
 * failure path.
 */
async function cleanupAndSend(
  restClient: CoveRestClient,
  channelId: string,
  draftMessageId: string | undefined,
  text: string,
  log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void },
): Promise<void> {
  if (draftMessageId) {
    try {
      await restClient.deleteMessage(channelId, draftMessageId);
    } catch (delErr: any) {
      log?.warn?.(`cove: failed to delete orphaned draft ${draftMessageId}: ${delErr.message}`);
    }
  }
  log?.info?.(`cove: reply → [${channelId}] (${text.length} chars)`);
  await restClient.sendMessage(channelId, text);
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
    // Support both channel and direct messages
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

      gatewayClient.on("reconnect", () => {
        log?.info?.(`cove: reconnected — aborting ${pendingDispatches.size} pending dispatch(es)`);
        for (const controller of pendingDispatches.values()) {
          controller.abort();
        }
        pendingDispatches.clear();
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

        // Register controller synchronously BEFORE any await to prevent ordering race:
        // two same-channel messages overlapping on await boundaries could abort the wrong one.
        const existingDispatch = pendingDispatches.get(channelId);
        if (existingDispatch) {
          log?.warn?.(`cove: aborting pending dispatch for [${channelId}] (superseded by new message)`);
          existingDispatch.abort();
        }
        const abortController = new AbortController();
        pendingDispatches.set(channelId, abortController);

        // Fire-and-forget early typing cue via REST endpoint
        const restClient = getRestClient(account.baseUrl, account.token);
        restClient.sendTyping(channelId).catch(() => {});

        const typingCallbacks = createTypingCallbacks({
          start: () => {
            return restClient.sendTyping(channelId);
          },
          keepaliveIntervalMs: 5000,
          maxDurationMs: 60000,
          onStartError: (err) => log?.warn?.(`cove: typing start error in [${channelId}]: ${err}`),
        });

        try {
          const { dispatchInboundDirectDmWithRuntime } = await loadDirectDm();

          const targetAgent = account.agentId;
          const originalRouting = channelRuntime.routing;
          const originalDispatcher = channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher;

          const draftState = { stopped: false, final: false };
          let draftMessageId: string | undefined;
          let lastSentText = "";
          // Pass the channel config section so tool-progress can read
          // channel-level settings (e.g. maxLines, labels).  `cfg` is the
          // full gateway config; the cove channel entry lives under
          // `channels.cove`.
          const channelEntry = cfg?.channels?.["cove"] ?? {};
          const dispatchTimeoutMs = (channelEntry as any).dispatchTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS;
          const toolProgress = createToolProgressTracker(channelEntry, {
            seed: message.id ?? String(Date.now()),
            onProgressUpdate: () => {
              const combined = toolProgress.getCombinedText();
              if (combined) draft.update(combined);
            },
          });

          // Sequential queue ensures PATCH requests land in order even if
          // multiple sendOrEdit calls overlap (e.g. rapid streaming ticks).
          let editQueue = Promise.resolve();

          /** Returns true if this dispatch is still the current one for this channel. */
          const isCurrent = () => pendingDispatches.get(channelId) === abortController;

          const sendOrEdit = async (text: string): Promise<boolean> => {
            if (!isCurrent()) return false;
            return new Promise<boolean>((resolve) => {
              editQueue = editQueue.then(async () => {
                if (!isCurrent()) { resolve(false); return; }
                if (draftState.stopped && !draftState.final) { resolve(false); return; }
                const trimmed = text.trimEnd();
                if (!trimmed || trimmed === lastSentText) { resolve(false); return; }
                lastSentText = trimmed;
                try {
                  if (draftMessageId) {
                    await restClient.editMessage(channelId, draftMessageId, trimmed);
                  } else {
                    const msg = await restClient.sendMessage(channelId, trimmed);
                    draftMessageId = msg.id;
                  }
                  resolve(true);
                } catch (err: any) {
                  draftState.stopped = true;
                  log?.warn?.(`cove: stream preview failed: ${err.message}`);
                  resolve(false);
                }
              });
            });
          };

          const draft = createFinalizableDraftLifecycle({
            throttleMs: 250,
            state: draftState,
            sendOrEditStreamMessage: sendOrEdit,
            readMessageId: () => draftMessageId,
            clearMessageId: () => { draftMessageId = undefined; },
            isValidMessageId: (v: unknown) => typeof v === "string",
            deleteMessage: async (messageId?: string) => {
              const idToDelete = messageId ?? draftMessageId;
              if (idToDelete) {
                try {
                  await restClient.deleteMessage(channelId, idToDelete);
                } catch (err: any) {
                  log?.warn?.(`cove: failed to delete draft message ${idToDelete}: ${err.message}`);
                }
              }
            },
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
                        if (!isCurrent()) return;
                        typingCallbacks.onCleanup?.();
                        const text = payload.text ?? "";
                        if (!text) return;

                        draftState.final = true;
                        await draft.seal();

                        // Re-check after async seal — dispatch may have been superseded
                        if (!isCurrent()) return;

                        // If streaming was stopped due to an earlier API error,
                        // the draftMessageId may be stale or absent. Fall back
                        // to sending a fresh message so the final reply is not
                        // silently lost.
                        if (draftMessageId && !draftState.stopped) {
                          log?.info?.(`cove: stream final → [${channelId}] (${text.length} chars)`);
                          try {
                            await restClient.editMessage(channelId, draftMessageId, text);
                          } catch (editErr: any) {
                            log?.warn?.(`cove: final edit failed for draft ${draftMessageId}: ${editErr.message}, falling back to sendMessage`);
                            await cleanupAndSend(restClient, channelId, draftMessageId, text, log);
                          }
                        } else {
                          await cleanupAndSend(restClient, channelId, draftMessageId, text, log);
                        }
                      },
                    },
                    replyOptions: {
                      ...params.replyOptions,
                      // Disable the DEFAULT block dispatcher so our custom
                      // createFinalizableDraftLifecycle handles streaming instead.
                      // This does NOT disable streaming events — only the built-in
                      // block delivery mechanism.
                      disableBlockStreaming: true,
                      suppressDefaultToolProgressMessages: true,
                      onPartialReply: (payload: any) => {
                        if (!isCurrent()) return;
                        if (payload?.text) {
                          toolProgress.onPartialReply(payload.text);
                          draft.update(payload.text);
                        }
                      },
                      onToolStart: (payload: any) => {
                        if (!isCurrent()) return;
                        toolProgress.onToolStart({
                          name: payload?.name ?? payload?.toolName,
                          args: payload?.args,
                          phase: payload?.phase,
                          detailMode: payload?.detailMode,
                        });
                      },
                      onItemEvent: (payload: any) => {
                        if (!isCurrent()) return;
                        toolProgress.onItemEvent(payload);
                      },
                      onPlanUpdate: (payload: any) => {
                        if (!isCurrent()) return;
                        toolProgress.onPlanUpdate(payload);
                      },
                      onApprovalEvent: (payload: any) => {
                        if (!isCurrent()) return;
                        toolProgress.onApprovalEvent(payload);
                      },
                      onCommandOutput: (payload: any) => {
                        if (!isCurrent()) return;
                        toolProgress.onCommandOutput(payload);
                      },
                      onPatchSummary: (payload: any) => {
                        if (!isCurrent()) return;
                        toolProgress.onPatchSummary(payload);
                      },
                      onCompactionStart: () => {
                        if (!isCurrent()) return;
                        toolProgress.onCompactionStart();
                        const combined = toolProgress.getCombinedText();
                        if (combined) draft.update(combined);
                      },
                      onCompactionEnd: () => {
                        if (!isCurrent()) return;
                        toolProgress.onCompactionEnd();
                      },
                      onAssistantMessageStart: () => {
                        if (!isCurrent()) return;
                        toolProgress.onAssistantMessageStart();
                      },
                    },
                  }),
              },
            },
          };

          // Yield event loop so WS typing frame flushes before heavy bootstrap work
          await new Promise<void>((resolve) => setTimeout(resolve, 1));

          // Controller already registered synchronously in the prologue above.
          // isCurrent() uses the controller registered at message entry.

          try {
            await createAbortableDispatch(
              dispatchInboundDirectDmWithRuntime({
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
          }),
              dispatchTimeoutMs,
              abortController.signal,
            );
          } catch (err: any) {
            if (err instanceof DispatchTimeoutError) {
              typingCallbacks.onCleanup?.();
              log?.warn?.(`cove: dispatch timed out after ${dispatchTimeoutMs}ms in [${channelId}]`);
            } else if (err instanceof DispatchAbortedError) {
              typingCallbacks.onCleanup?.();
              log?.info?.(`cove: dispatch aborted in [${channelId}]`);
            } else {
              throw err;
            }
          } finally {
            // Only remove if this is still our controller (not replaced by a newer dispatch)
            if (pendingDispatches.get(channelId) === abortController) {
              pendingDispatches.delete(channelId);
            }
          }
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
