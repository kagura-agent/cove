/** Cove message dispatch — inbound turn, draft streaming, tool progress, final delivery. */
import { type CoveAccount, COVE_TEXT_CHUNK_LIMIT } from "./types.js";
import type { CoveRestClient } from "./rest-client.js";
import type { Message } from "@cove/shared";
import {
  createTypingCallbacks,
  buildChannelProgressDraftLineForEntry,
  buildChannelProgressDraftLine,
  defineFinalizableLivePreviewAdapter,
  deliverWithFinalizableLivePreviewAdapter,
  resolveChannelStreamingBlockEnabled,
} from "openclaw/plugin-sdk/channel-message";
import { createCoveDraftPreviewController } from "./draft-preview.js";
import { getCoveMd } from "./cove-md-cache.js";
import { resolveCoveMdChannelId, collectImageAttachmentUrls, buildBodyForAgent } from "./build-context.js";

const loadInbound = () => import("openclaw/plugin-sdk/inbound-reply-dispatch");
const loadMessageSend = () => import("openclaw/plugin-sdk/channel-message");
export interface DispatchMessageOptions {
  message: Message; batchedMessages?: Message[]; account: CoveAccount;
  restClient: CoveRestClient; channelRuntime: any; cfg: any;
  accountId: string; pendingDispatches: Map<string, AbortController>;
  log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void; error?: (...a: any[]) => void };
}

/** Check whether the dispatch has been aborted (matches Discord's `isProcessAborted`). */
function isProcessAborted(abortSignal: AbortSignal | undefined): boolean {
  return Boolean(abortSignal?.aborted);
}

export async function dispatchMessage(opts: DispatchMessageOptions): Promise<void> {
  const { message, batchedMessages, account, restClient, channelRuntime, cfg, accountId, pendingDispatches, log } = opts;
  const channelId = message.channel_id;
  const senderId = message.author.id;
  const senderName = message.author.global_name || message.author.username;

  // Abort old dispatch for this channel (Discord parity: preempt-on-new-message)
  const existingController = pendingDispatches.get(channelId);
  if (existingController) existingController.abort();

  const abortController = new AbortController();
  const abortSignal = abortController.signal;
  pendingDispatches.set(channelId, abortController);
  restClient.sendTyping(channelId).catch(() => {});

  const typingCallbacks = createTypingCallbacks({
    start: () => restClient.sendTyping(channelId),
    keepaliveIntervalMs: 5000, maxDurationMs: 60000,
    onStartError: (err) => log?.warn?.(`cove: typing start error in [${channelId}]: ${err}`),
  });

  // --- Outer try/finally: typing cleanup (mirrors Discord's processDiscordMessage) ---
  try {
    await dispatchMessageInner(opts, abortSignal, typingCallbacks);
  } finally {
    typingCallbacks.onCleanup?.();
  }
}

/**
 * Inner dispatch — mirrors Discord's `processDiscordMessageInner`.
 * Separated so the outer function's finally block can unconditionally clean up typing.
 */
async function dispatchMessageInner(
  opts: DispatchMessageOptions,
  abortSignal: AbortSignal,
  typingCallbacks: { onReplyStart?: () => Promise<void>; onCleanup?: () => void },
): Promise<void> {
  const { message, batchedMessages, account, restClient, channelRuntime, cfg, accountId, pendingDispatches, log } = opts;
  const channelId = message.channel_id;
  const senderId = message.author.id;
  const senderName = message.author.global_name || message.author.username;

  // Abort check #1 — before any work
  if (isProcessAborted(abortSignal)) return;

  const { runInboundReplyTurn } = await loadInbound();
  const targetAgent = account.agentId;
  const originalDispatcher = channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher;
  const recordInboundSession = channelRuntime.session.recordInboundSession.bind(channelRuntime.session);

  const channelEntry = cfg?.channels?.["cove"] ?? {};
  const resolvedBlockStreamingEnabled = resolveChannelStreamingBlockEnabled(channelEntry);

  const draftPreview = createCoveDraftPreviewController({
    cfg,
    channelConfig: channelEntry,
    accountId,
    sourceRepliesAreToolOnly: false,
    textLimit: COVE_TEXT_CHUNK_LIMIT,
    restClient,
    deliverChannelId: channelId,
    replyReference: { peek: () => undefined },
    log: (msg: string) => log?.info?.(msg),
  });

  /** Chunked fresh send via sendDurableMessageBatch. */
  const freshSend = async (text: string) => {
    log?.info?.(`cove: reply → [${channelId}] (${text.length} chars)`);
    const { sendDurableMessageBatch } = await loadMessageSend();
    await sendDurableMessageBatch({
      cfg, channel: "cove" as any, to: `channel:${channelId}`, accountId,
      payloads: [{ text }], formatting: { textLimit: COVE_TEXT_CHUNK_LIMIT },
      deps: { cove: (ctx: any) => {
        const chunk = ctx.text ?? ctx.body;
        if (!chunk) throw new Error("cove: sendText callback received empty chunk");
        return restClient.sendMessage(ctx.to?.replace('channel:', '') ?? channelId, chunk);
      } },
    });
  };

  let userFacingFinalDelivered = false;
  const markUserFacingFinalDelivered = () => {
    userFacingFinalDelivered = true;
    draftPreview.markFinalReplyDelivered();
  };

  const dispatcherOptions = {
    typingCallbacks,
    deliver: async (payload: any, info: { kind: string }) => {
      // Abort check — before delivery (mirrors Discord's deliverDiscordPayload)
      if (isProcessAborted(abortSignal)) {
        log?.info?.(`cove: reply skipped in [${channelId}] (aborted before delivery)`);
        return;
      }
      typingCallbacks.onCleanup?.();
      const text = payload.text ?? "";
      if (!text) return;

      const draftStream = draftPreview.draftStream;
      const isFinal = info.kind === "final";

      if (isFinal) draftPreview.markFinalReplyStarted();

      // Attempt live preview finalization (Layer 3)
      if (draftStream && isFinal && (!draftPreview.isProgressMode || draftPreview.hasProgressDraftStarted) && !payload.isError) {
        const previewFinalText = draftPreview.resolvePreviewFinalText(text);

        const result = await deliverWithFinalizableLivePreviewAdapter({
          kind: info.kind as "tool" | "block" | "final",
          payload,
          adapter: defineFinalizableLivePreviewAdapter({
            draft: {
              flush: () => draftPreview.flush(),
              clear: () => draftStream.clear(),
              discardPending: () => draftStream.discardPending(),
              seal: () => draftStream.seal(),
              id: draftStream.messageId,
            },
            buildFinalEdit: () => {
              if (draftPreview.finalizedViaPreviewMessage) return;
              if (typeof previewFinalText !== "string") return;
              if (payload.isError) return;
              return { content: previewFinalText };
            },
            editFinal: async (previewMessageId: string, edit: { content: string }) => {
              if (isProcessAborted(abortSignal)) throw new Error("process aborted");
              await restClient.editMessage(channelId, previewMessageId, edit.content);
            },
            onPreviewFinalized: () => {
              markUserFacingFinalDelivered();
              draftPreview.markPreviewFinalized();
            },
            logPreviewEditFailure: (err: unknown) => {
              log?.warn?.(`cove: preview final edit failed; falling back to standard send (${String(err)})`);
            },
          }),
          deliverNormally: async () => {
            if (isProcessAborted(abortSignal)) return false;
            await freshSend(text);
            return true;
          },
          onNormalDelivered: () => {
            markUserFacingFinalDelivered();
          },
        });

        if (result.kind !== "normal-skipped") return;
      }

      // Fallback: standard send — check abort again before sending
      if (isProcessAborted(abortSignal)) {
        log?.info?.(`cove: reply skipped in [${channelId}] (aborted before delivery)`);
        return;
      }
      await freshSend(text);
      if (isFinal && !payload.isError) markUserFacingFinalDelivered();
    },
  };

  const replyOptions = {
    abortSignal,

    disableBlockStreaming:
      draftPreview.disableBlockStreamingForDraft
      ?? (typeof resolvedBlockStreamingEnabled === "boolean"
        ? !resolvedBlockStreamingEnabled : undefined),

    suppressDefaultToolProgressMessages:
      draftPreview.suppressDefaultToolProgressMessages ? true : undefined,

    commentaryProgressEnabled:
      draftPreview.isProgressMode ? draftPreview.commentaryProgressEnabled : undefined,

    onPartialReply: draftPreview.draftStream && !draftPreview.isProgressMode
      ? (payload: any) => { if (!isProcessAborted(abortSignal)) draftPreview.updateFromPartial(payload.text); }
      : undefined,

    onAssistantMessageStart: draftPreview.draftStream
      ? () => { if (!isProcessAborted(abortSignal)) draftPreview.handleAssistantMessageBoundary(); }
      : undefined,

    onReasoningEnd: draftPreview.draftStream
      ? () => { if (!isProcessAborted(abortSignal)) draftPreview.handleAssistantMessageBoundary(); }
      : undefined,

    onReasoningStream: async (payload: any) => {
      if (isProcessAborted(abortSignal)) return;
      await draftPreview.pushReasoningProgress(payload?.text, {
        snapshot: payload?.isReasoningSnapshot === true,
      });
    },

    onToolStart: async (payload: any) => {
      if (isProcessAborted(abortSignal)) return;
      await draftPreview.pushToolProgress(
        buildChannelProgressDraftLineForEntry(channelEntry, {
          event: "tool", name: payload.name, phase: payload.phase, args: payload.args,
        }, payload.detailMode ? { detailMode: payload.detailMode } : undefined),
        { toolName: payload.name },
      );
    },

    onItemEvent: async (payload: any) => {
      if (isProcessAborted(abortSignal)) return;
      if (payload.kind === "preamble") {
        if (draftPreview.commentaryProgressEnabled && payload.progressText) {
          await draftPreview.pushCommentaryProgress(payload.progressText, { itemId: payload.itemId });
        }
        return;
      }
      await draftPreview.pushToolProgress(
        buildChannelProgressDraftLineForEntry(channelEntry, {
          event: "item", itemId: payload.itemId, itemKind: payload.kind,
          title: payload.title, name: payload.name, phase: payload.phase,
          status: payload.status, summary: payload.summary,
          progressText: payload.progressText, meta: payload.meta,
        }),
      );
    },

    onPlanUpdate: async (payload: any) => {
      if (isProcessAborted(abortSignal)) return;
      if (payload.phase !== "update") return;
      await draftPreview.pushToolProgress(buildChannelProgressDraftLine({
        event: "plan", phase: payload.phase, title: payload.title,
        explanation: payload.explanation, steps: payload.steps,
      }));
    },

    onApprovalEvent: async (payload: any) => {
      if (isProcessAborted(abortSignal)) return;
      if (payload.phase !== "requested") return;
      await draftPreview.pushToolProgress(buildChannelProgressDraftLine({
        event: "approval", phase: payload.phase, title: payload.title,
        command: payload.command, reason: payload.reason, message: payload.message,
      }));
    },

    onCommandOutput: async (payload: any) => {
      if (isProcessAborted(abortSignal)) return;
      if (payload.phase !== "end") return;
      await draftPreview.pushToolProgress(buildChannelProgressDraftLine({
        event: "command-output", phase: payload.phase, title: payload.title,
        name: payload.name, status: payload.status, exitCode: payload.exitCode,
      }));
    },

    onPatchSummary: async (payload: any) => {
      if (isProcessAborted(abortSignal)) return;
      if (payload.phase !== "end") return;
      await draftPreview.pushToolProgress(buildChannelProgressDraftLine({
        event: "patch", phase: payload.phase, title: payload.title,
        name: payload.name, added: payload.added, modified: payload.modified,
        deleted: payload.deleted, summary: payload.summary,
      }));
    },

    onCompactionStart: async () => {
      // No draft preview update — Cove doesn't show compaction in preview
    },

    onCompactionEnd: async () => {
      // No draft preview update — Cove doesn't show compaction in preview
    },
  };

  // Abort check #2 — before context resolution
  if (isProcessAborted(abortSignal)) return;

  await new Promise<void>((resolve) => setTimeout(resolve, 1)); // yield for WS typing frame
  const coveMdChannelId = await resolveCoveMdChannelId(restClient, channelId);
  const coveMdContent = await getCoveMd(restClient, coveMdChannelId, log);

  // Abort check #3 — after async context resolution
  if (isProcessAborted(abortSignal)) return;

  const fullAttachmentUrls = collectImageAttachmentUrls(message, batchedMessages, account.baseUrl);
  const bodyForAgent = buildBodyForAgent(message, batchedMessages, fullAttachmentUrls, account.baseUrl);

  // --- Inner try/finally: draft cleanup (mirrors Discord's processDiscordMessageInner finally) ---
  try {
    // Abort check #4 — before dispatch
    if (isProcessAborted(abortSignal)) return;

    const messageId = message.id ?? `cove-${Date.now()}`;
    const ctxPayload = {
      Body: message.content, BodyForAgent: bodyForAgent,
      CommandBody: message.content, RawBody: message.content,
      From: senderId, To: channelId, ChannelId: channelId,
      SessionKey: `agent:${targetAgent}:cove:group:${channelId}`,
      AgentId: targetAgent, AccountId: accountId, MessageSid: messageId,
      Provider: "cove", Surface: "cove", ChatType: "channel",
      SenderId: senderId, SenderName: senderName, CommandAuthorized: false,
      ...(coveMdContent ? { GroupSystemPrompt: "Channel rules from cove.md (channel-editable):\n\n" + coveMdContent } : {}),
      ...(message.message_reference?.message_id ? {
        ReplyToId: message.message_reference.message_id,
        ReplyToBody: message.referenced_message?.content,
        ReplyToSender: message.referenced_message?.author?.global_name || message.referenced_message?.author?.username,
      } : {}),
      ...(fullAttachmentUrls.length > 0 ? { MediaUrls: fullAttachmentUrls, allowUnsafeExternalContent: true } : {}),
    } as any;

    await runInboundReplyTurn({
      channel: "cove", accountId, raw: message,
      adapter: {
        ingest: () => ({
          id: messageId, timestamp: message.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
          rawText: message.content, textForAgent: bodyForAgent, textForCommands: message.content, raw: message,
        }),
        resolveTurn: () => ({
          channel: "cove", accountId, agentId: targetAgent,
          routeSessionKey: `agent:${targetAgent}:cove:group:${channelId}`,
          storePath: "", ctxPayload, recordInboundSession,
          runDispatch: () => originalDispatcher({ ctx: ctxPayload, cfg, dispatcherOptions, replyOptions }),
          log: (event: any) => { if (event.event === "error") log?.error?.(`cove: turn error in [${channelId}]: ${event.error}`); },
        }),
      },
    });

    // Abort check #5 — after dispatch completes
    if (isProcessAborted(abortSignal)) return;
  } catch (err: any) {
    // Abort check #6 — suppress errors from aborted dispatch
    if (isProcessAborted(abortSignal)) {
      log?.info?.(`cove: dispatch aborted in [${channelId}]`);
      return;
    }
    log?.error?.(`cove: error in [${channelId}]: ${err.message}`);
  } finally {
    // Unconditional cleanup (mirrors Discord's finally block)
    await draftPreview.cleanup();
    const abortController = pendingDispatches.get(channelId);
    if (abortController?.signal === abortSignal) pendingDispatches.delete(channelId);
  }
}
