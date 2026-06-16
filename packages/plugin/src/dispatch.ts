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
import { getCoveMd } from "./cove-md-cache.js";

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
  batchedMessages?: Message[];
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
  const { message, batchedMessages, account, restClient, channelRuntime, cfg, accountId, pendingDispatches, log } = opts;
  const channelId = message.channel_id;
  const senderId = message.author.id;
  const senderName = message.author.global_name || message.author.username;

  // Track this dispatch (for shutdown/reconnect cleanup, NOT for message superseding)
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

    // Read channel's cove.md for bot context injection (cached)
    // For threads, read cove.md from parent channel (threads don't have their own)
    let coveMdChannelId = channelId;
    try {
      const channel = await restClient.getChannel(channelId);
      if (channel.type === 11 && channel.parent_id) {
        coveMdChannelId = channel.parent_id;
      }
    } catch { /* fall back to channelId */ }
    const coveMdContent = await getCoveMd(restClient, coveMdChannelId, log);

    // Build attachment context for agent
    const imageAttachments = (message.attachments || []).filter((a: any) => a.content_type?.startsWith('image/'));
    const attachmentUrls = imageAttachments.map((a: any) => a.url);
    const fullAttachmentUrls = attachmentUrls.map((url: string) => {
      if (url.startsWith('/')) return account.baseUrl + url;
      return url;
    });

    // Collect image attachments from batched messages
    if (batchedMessages) {
      for (const bm of batchedMessages) {
        const bmImages = (bm.attachments || []).filter((a: any) => a.content_type?.startsWith('image/'));
        for (const a of bmImages) {
          const url = a.url.startsWith('/') ? account.baseUrl + a.url : a.url;
          if (!fullAttachmentUrls.includes(url)) fullAttachmentUrls.push(url);
        }
      }
    }

    // Build message body with batched context
    let bodyForAgent = message.content;
    if (batchedMessages && batchedMessages.length > 0) {
      const contextLines = batchedMessages.map((m) => {
        const name = m.author?.global_name || m.author?.username || 'Unknown';
        let line = name + ': ' + m.content;
        // Inline image markers next to the sending author
        const msgImages = (m.attachments || []).filter((a: any) => a.content_type?.startsWith('image/'));
        for (const img of msgImages) {
          const imgUrl = img.url.startsWith('/') ? account.baseUrl + img.url : img.url;
          line += ' [image: ' + imgUrl + ']';
        }
        return line;
      });
      bodyForAgent = contextLines.join('\n') + '\n\n' + bodyForAgent;
    }

    // Append image URLs to body so agent sees them
    if (fullAttachmentUrls.length > 0) {
      const urlsText = fullAttachmentUrls.map((url: string) => '[image: ' + url + ']').join('\n');
      bodyForAgent = bodyForAgent ? bodyForAgent + '\n\n' + urlsText : urlsText;
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
          bodyForAgent: bodyForAgent,
          messageId: message.id ?? `cove-${Date.now()}`,
          timestamp: message.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
          provider: "cove",
          surface: "cove",
          extraContext: {
            ChatType: "channel",
            SenderId: senderId,
            SenderName: senderName,
            ChannelId: channelId,
            ...(coveMdContent ? {
              GroupSystemPrompt: "Channel rules from cove.md (channel-editable):\n\n" + coveMdContent,
            } : {}),
            ...(message.message_reference?.message_id ? {
              ReplyToId: message.message_reference.message_id,
              ReplyToBody: message.referenced_message?.content,
              ReplyToSender: message.referenced_message?.author?.global_name || message.referenced_message?.author?.username,
            } : {}),
            ...(fullAttachmentUrls.length > 0 ? {
              MediaUrls: fullAttachmentUrls,
              allowUnsafeExternalContent: true,
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
