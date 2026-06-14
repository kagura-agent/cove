/**
 * Cove message dispatch pipeline.
 *
 * Extracted from channel.ts to keep the gateway handler focused on wiring
 * and delegation. Contains:
 * - Abort tracking and dispatch lifecycle
 * - Draft message streaming (send/edit queue)
 * - Tool progress integration
 * - Final delivery with fallback
 */

import type { CoveAccount } from "./types.js";
import type { CoveRestClient } from "./rest-client.js";
import type { Message } from "@cove/shared";
import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-message";
import { createFinalizableDraftLifecycle } from "openclaw/plugin-sdk/channel-lifecycle";
import { createToolProgressTracker } from "./tool-progress.js";

const loadDirectDm = () => import("openclaw/plugin-sdk/channel-inbound");

/**
 * Clean up an orphaned draft message and fall back to sending a fresh
 * message. Reused by both the streaming-error path and the final-edit
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

export interface DispatchMessageOptions {
  message: Message;
  account: CoveAccount;
  restClient: CoveRestClient;
  channelRuntime: any;
  cfg: any;
  accountId: string;
  pendingDispatches: Map<string, AbortController>;
  log?: {
    info?: (...a: any[]) => void;
    warn?: (...a: any[]) => void;
    error?: (...a: any[]) => void;
  };
}

/**
 * Dispatch an inbound message through the OpenClaw runtime.
 *
 * Handles: abort tracking, typing indicators, draft streaming lifecycle,
 * tool progress, and final message delivery with fallback.
 */
export async function dispatchMessage(opts: DispatchMessageOptions): Promise<void> {
  const { message, account, restClient, channelRuntime, cfg, accountId, pendingDispatches, log } = opts;
  const channelId = message.channel_id;
  const senderId = message.author.id;
  const senderName = message.author.global_name || message.author.username;

  // Register controller synchronously BEFORE any await to prevent ordering race
  const existingDispatch = pendingDispatches.get(channelId);
  if (existingDispatch) {
    log?.warn?.(`cove: aborting pending dispatch for [${channelId}] (superseded by new message)`);
    existingDispatch.abort();
  }
  const abortController = new AbortController();
  pendingDispatches.set(channelId, abortController);

  // Fire-and-forget early typing cue via REST endpoint
  restClient.sendTyping(channelId).catch(() => {});

  const typingCallbacks = createTypingCallbacks({
    start: () => restClient.sendTyping(channelId),
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
    const channelEntry = cfg?.channels?.["cove"] ?? {};
    const toolProgress = createToolProgressTracker(channelEntry, {
      seed: message.id ?? String(Date.now()),
      onProgressUpdate: () => {
        const combined = toolProgress.getCombinedText();
        if (combined) draft.update(combined);
      },
    });

    // Sequential queue ensures PATCH requests land in order
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

                  if (!isCurrent()) return;

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

    // Read channel's cove.md for bot context injection
    let coveMdContent: string | undefined;
    try {
      const coveMd = await restClient.getChannelFile(channelId, 'cove.md');
      if (coveMd?.content && Buffer.byteLength(coveMd.content, 'utf8') <= 8000) {
        coveMdContent = coveMd.content;
      }
    } catch (err) {
      // cove.md is optional — log unexpected errors for observability but don't block dispatch
      log?.warn?.(`cove: failed to fetch cove.md for [${channelId}]: ${err instanceof Error ? err.message : err}`);
    }

    try {
      await dispatchInboundDirectDmWithRuntime({
          cfg,
          runtime: patchedRuntime as any,
          channel: "cove",
          channelLabel: "Cove",
          accountId,
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
            ...(coveMdContent ? { ChannelContext: coveMdContent } : {}),
            ...(message.message_reference?.message_id ? {
              ReplyToId: message.message_reference.message_id,
              ReplyToBody: message.referenced_message?.content,
              ReplyToSender: message.referenced_message?.author?.global_name || message.referenced_message?.author?.username,
            } : {}),
          },
          deliver: async (_payload) => {
            // Delivery handled by the dispatcher's deliver callback above
          },
          onRecordError: (err) => {
            log?.error?.(`cove: record error in [${channelId}]: ${err}`);
          },
          onDispatchError: (err, info) => {
            log?.error?.(`cove: dispatch error (${info.kind}) in [${channelId}]: ${err}`);
          },
        });
    } catch (err: any) {
      if (abortController.signal.aborted) {
        typingCallbacks.onCleanup?.();
        log?.info?.(`cove: dispatch aborted in [${channelId}]`);
      } else {
        throw err;
      }
    } finally {
      if (pendingDispatches.get(channelId) === abortController) {
        pendingDispatches.delete(channelId);
      }
    }
  } catch (err: any) {
    typingCallbacks.onCleanup?.();
    log?.error?.(`cove: error in [${channelId}]: ${err.message}`);
  }
}
