/**
 * Cove message dispatch pipeline.
 *
 * Refactored to use SDK's sendDurableMessageBatch for delivery,
 * which auto-chunks via the registered coveMessageAdapter.
 */

import type { CoveAccount } from './types.js';
import type { CoveRestClient } from './rest-client.js';
import type { Message } from '@cove/shared';
import { createTypingCallbacks } from 'openclaw/plugin-sdk/channel-message';
import { chunkTextForOutbound } from 'openclaw/plugin-sdk/text-chunking';
import { createToolProgressTracker } from './tool-progress.js';
import { getCoveMd } from './cove-md-cache.js';

const loadDirectDm = () => import('openclaw/plugin-sdk/channel-inbound');

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

export async function dispatchMessage(opts: DispatchMessageOptions): Promise<void> {
  const { message, batchedMessages, account, restClient, channelRuntime, cfg, accountId, pendingDispatches, log } = opts;
  const channelId = message.channel_id;
  const senderId = message.author.id;
  const senderName = message.author.global_name || message.author.username;

  const abortController = new AbortController();
  pendingDispatches.set(channelId, abortController);

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

    const channelEntry = cfg?.channels?.['cove'] ?? {};
    const toolProgress = createToolProgressTracker(channelEntry, {
      seed: message.id ?? String(Date.now()),
      onProgressUpdate: () => {
        // Tool progress now relies on SDK streaming, not manual draft
      },
    });

    const isCurrent = () => pendingDispatches.get(channelId) === abortController;

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
                  const text = payload.text ?? '';
                  if (!text) return;

                  log?.info?.(`cove: delivering reply → [${channelId}] (${text.length} chars)`);

                  // Chunk using SDK's chunkTextForOutbound (same as Discord pattern)
                  const COVE_TEXT_CHUNK_LIMIT = 4000;
                  const chunks = chunkTextForOutbound(text, COVE_TEXT_CHUNK_LIMIT);
                  for (const chunk of chunks) {
                    await restClient.sendMessage(channelId, chunk);
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

    await new Promise<void>((resolve) => setTimeout(resolve, 1));

    // Read cove.md (from parent channel for threads)
    let coveMdChannelId = channelId;
    try {
      const channel = await restClient.getChannel(channelId);
      if (channel.type === 11 && channel.parent_id) {
        coveMdChannelId = channel.parent_id;
      }
    } catch { /* fall back to channelId */ }
    const coveMdContent = await getCoveMd(restClient, coveMdChannelId, log);

    // Image attachments
    const imageAttachments = (message.attachments || []).filter((a: any) => a.content_type?.startsWith('image/'));
    const attachmentUrls = imageAttachments.map((a: any) => a.url);
    const fullAttachmentUrls = attachmentUrls.map((url: string) => {
      if (url.startsWith('/')) return account.baseUrl + url;
      return url;
    });

    if (batchedMessages) {
      for (const bm of batchedMessages) {
        const bmImages = (bm.attachments || []).filter((a: any) => a.content_type?.startsWith('image/'));
        for (const a of bmImages) {
          const url = a.url.startsWith('/') ? account.baseUrl + a.url : a.url;
          if (!fullAttachmentUrls.includes(url)) fullAttachmentUrls.push(url);
        }
      }
    }

    // Build message body
    let bodyForAgent = message.content;
    if (batchedMessages && batchedMessages.length > 0) {
      const contextLines = batchedMessages.map((m) => {
        const name = m.author?.global_name || m.author?.username || 'Unknown';
        let line = name + ': ' + m.content;
        const msgImages = (m.attachments || []).filter((a: any) => a.content_type?.startsWith('image/'));
        for (const img of msgImages) {
          const imgUrl = img.url.startsWith('/') ? account.baseUrl + img.url : img.url;
          line += ' [image: ' + imgUrl + ']';
        }
        return line;
      });
      bodyForAgent = contextLines.join('\n') + '\n\n' + bodyForAgent;
    }

    if (fullAttachmentUrls.length > 0) {
      const urlsText = fullAttachmentUrls.map((url: string) => '[image: ' + url + ']').join('\n');
      bodyForAgent = bodyForAgent ? bodyForAgent + '\n\n' + urlsText : urlsText;
    }

    try {
      await dispatchInboundDirectDmWithRuntime({
        cfg,
        runtime: patchedRuntime as any,
        channel: 'cove',
        channelLabel: 'Cove',
        accountId,
        peer: { kind: 'group' as any, id: channelId },
        senderId,
        senderAddress: senderId,
        recipientAddress: channelId,
        conversationLabel: `#${channelId}`,
        rawBody: message.content,
        bodyForAgent: bodyForAgent,
        messageId: message.id ?? `cove-${Date.now()}`,
        timestamp: message.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
        provider: 'cove',
        surface: 'cove',
        extraContext: {
          ChatType: 'channel',
          SenderId: senderId,
          SenderName: senderName,
          ChannelId: channelId,
          ...(coveMdContent ? {
            GroupSystemPrompt: 'Channel rules from cove.md (channel-editable):\n\n' + coveMdContent,
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
