/** Cove message dispatch — inbound turn, draft streaming, tool progress, final delivery. */
import { type CoveAccount, COVE_TEXT_CHUNK_LIMIT } from "./types.js";
import type { CoveRestClient } from "./rest-client.js";
import type { Message } from "@cove/shared";
import { createTypingCallbacks, deliverWithFinalizableLivePreviewAdapter, defineFinalizableLivePreviewAdapter } from "openclaw/plugin-sdk/channel-message";
import { createFinalizableDraftLifecycle } from "openclaw/plugin-sdk/channel-lifecycle";
import { createChannelProgressDraftCompositor, formatChannelProgressDraftLineForEntry, formatChannelProgressDraftLine, buildChannelProgressDraftLineForEntry } from "openclaw/plugin-sdk/channel-outbound";
import { getCoveMd } from "./cove-md-cache.js";
import { resolveCoveMdChannelId, collectImageAttachmentUrls, buildBodyForAgent } from "./build-context.js";
import { createCoveOutboundBridgeAdapter } from "./outbound.js";

const loadInbound = () => import("openclaw/plugin-sdk/inbound-reply-dispatch");
export interface DispatchMessageOptions {
  message: Message; account: CoveAccount;
  restClient: CoveRestClient; channelRuntime: any; cfg: any;
  accountId: string; abortSignal?: AbortSignal;
  log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void; error?: (...a: any[]) => void };
}

export async function dispatchMessage(opts: DispatchMessageOptions): Promise<void> {
  const { message, account, restClient, channelRuntime, cfg, accountId, abortSignal, log } = opts;
  const channelId = message.channel_id;
  const senderId = message.author.id;
  const senderName = message.author.global_name || message.author.username;

  const isAborted = () => Boolean(abortSignal?.aborted);
  restClient.sendTyping(channelId).catch(() => {});

  const typingCallbacks = createTypingCallbacks({
    start: () => restClient.sendTyping(channelId),
    keepaliveIntervalMs: 5000, maxDurationMs: 60000,
    onStartError: (err) => log?.warn?.(`cove: typing start error in [${channelId}]: ${err}`),
  });

  try { // typing lifecycle: finally guarantees cleanup on all exit paths
    const { runInboundReplyTurn } = await loadInbound();
    const targetAgent = account.agentId;
    const originalDispatcher = channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher;
    const recordInboundSession = channelRuntime.session.recordInboundSession.bind(channelRuntime.session);

    const draftState = { stopped: false, final: false };
    let draftMessageId: string | undefined;
    let lastSentText = "";
    let finalReplyDelivered = false;
    let finalizedViaPreviewMessage = false;
    const channelEntry = cfg?.channels?.["cove"] ?? {};

    let warnedSendOrEditAborted = false;
    const sendOrEdit = async (text: string): Promise<boolean> => {
      if (isAborted()) {
        if (!warnedSendOrEditAborted) {
          log?.warn?.(`cove: stream update skipped — dispatch aborted for [${channelId}] (message: ${message.id})`);
          warnedSendOrEditAborted = true;
        }
        return false;
      }
      if (draftState.stopped && !draftState.final) return false;
      const trimmed = text.trimEnd();
      if (!trimmed || trimmed === lastSentText) return false;
      lastSentText = trimmed;
      const preview = trimmed.length > COVE_TEXT_CHUNK_LIMIT
        ? trimmed.slice(0, COVE_TEXT_CHUNK_LIMIT - 1) + "…"
        : trimmed;
      try {
        if (draftMessageId) {
          await restClient.editMessage(channelId, draftMessageId, preview);
        } else {
          const msg = await restClient.sendMessage(channelId, preview);
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
      throttleMs: 250, state: draftState,
      sendOrEditStreamMessage: sendOrEdit,
      readMessageId: () => draftMessageId,
      clearMessageId: () => { draftMessageId = undefined; },
      isValidMessageId: (v: unknown) => typeof v === "string",
      deleteMessage: async (messageId?: string) => {
        const id = messageId ?? draftMessageId;
        if (id) {
          try { await restClient.deleteMessage(channelId, id); }
          catch (e: any) { log?.warn?.(`cove: failed to delete draft ${id}: ${e.message}`); }
        }
      },
      warnPrefix: "cove",
    });

    // Create compositor — replaces createToolProgressTracker
    const progressDraft = createChannelProgressDraftCompositor({
      entry: channelEntry,
      mode: "progress",
      active: true,
      seed: message.id ?? String(Date.now()),
      update: async (streamText, options) => {
        draft.update(streamText);
        if (options?.flush) await draft.loop.flush();
      },
    });

    const outboundBridge = createCoveOutboundBridgeAdapter({ agentId: targetAgent, log });

    const freshSend = async (text: string) => {
      if (isAborted()) {
        log?.warn?.(`cove: freshSend skipped — dispatch aborted for [${channelId}] (message: ${message.id}, ${text.length} chars)`);
        return;
      }
      if (draftMessageId) {
        try { await restClient.deleteMessage(channelId, draftMessageId); }
        catch (e: any) { log?.warn?.(`cove: failed to delete draft ${draftMessageId}: ${e.message}`); }
        draftMessageId = undefined;
      }
      log?.info?.(`cove: reply → [${channelId}] (${text.length} chars)`);
      if (!outboundBridge.sendText) throw new Error("cove: outbound adapter missing sendText");
      try {
        await outboundBridge.sendText({ cfg, to: channelId, accountId, text });
      } catch (e: any) {
        log?.warn?.(`cove: freshSend sendText failed for [${channelId}]: ${e.message}`);
        throw e;
      }
      finalReplyDelivered = true;
    };

    const adapter = defineFinalizableLivePreviewAdapter<{ text: string }, string, string>({
      draft: {
        flush: () => draft.loop.flush(),
        id: () => draftMessageId,
        seal: () => draft.seal(),
        discardPending: () => draft.discardPending(),
        clear: async () => {
          if (draftMessageId) {
            try { await restClient.deleteMessage(channelId, draftMessageId); }
            catch (e: any) { log?.warn?.(`cove: failed to delete draft ${draftMessageId}: ${e.message}`); }
          }
        },
      },
      buildFinalEdit: (payload) => payload.text || undefined,
      editFinal: async (id, text) => {
        if (isAborted()) {
          log?.warn?.(`cove: editFinal skipped — dispatch aborted for [${channelId}] (message: ${message.id}, ${text.length} chars)`);
          throw new Error("cove: dispatch aborted");
        }
        if (text.length > COVE_TEXT_CHUNK_LIMIT) {
          await freshSend(text);
        } else {
          await restClient.editMessage(channelId, id, text);
          finalizedViaPreviewMessage = true;
        }
      },
      handlePreviewEditError: () => "fallback",
      logPreviewEditFailure: (err: unknown) => {
        log?.warn?.(`cove: final edit failed: ${(err as Error).message}`);
      },
    });

    const guardFwd = (fn: (...a: any[]) => void) => (...a: any[]) => { if (!isAborted()) fn(...a); };

    const dispatcherOptions = {
      typingCallbacks,
      deliver: async (payload: any, _info: { kind: string }) => {
        if (isAborted()) {
          log?.warn?.(`cove: deliver skipped — dispatch aborted for [${channelId}] (message: ${message.id})`);
          return;
        }
        typingCallbacks.onCleanup?.();
        const text = payload.text ?? "";
        if (!text) {
          log?.info?.(`cove: deliver called with empty text for [${channelId}] (message: ${message.id})`);
          return;
        }
        if (isAborted()) {
          log?.warn?.(`cove: deliver skipped (post-text) — dispatch aborted for [${channelId}] (message: ${message.id}, ${text.length} chars)`);
          return;
        }
        progressDraft.markFinalReplyDelivered();
        const canFinalize = Boolean(draftMessageId && !draftState.stopped);
        await deliverWithFinalizableLivePreviewAdapter({
          kind: "final",
          payload: { text },
          liveState: { phase: canFinalize ? "previewing" : "idle", canFinalizeInPlace: canFinalize },
          adapter,
          deliverNormally: (p) => freshSend(p.text),
        });
        finalReplyDelivered = true;
      },
    };

    const replyOptions = {
      disableBlockStreaming: true,
      suppressDefaultToolProgressMessages: true,
      onToolStart: (p: any) => {
        if (isAborted()) return;
        const name = p?.name ?? p?.toolName ?? "tool";
        const line = formatChannelProgressDraftLineForEntry(
          channelEntry,
          { event: "tool", name, phase: p?.phase, args: p?.args },
          p?.detailMode ? { detailMode: p.detailMode as "explain" | "raw" } : undefined,
        );
        if (line) progressDraft.pushToolProgress(line, { toolName: name });
      },
      onItemEvent: guardFwd((p: any) => {
        const line = buildChannelProgressDraftLineForEntry(channelEntry, {
          event: "item",
          itemId: p.itemId,
          itemKind: p.kind,
          title: p.title,
          name: p.name,
          phase: p.phase,
          status: p.status,
          summary: p.summary,
          progressText: p.progressText,
          meta: p.meta,
        });
        if (line) progressDraft.pushToolProgress(line);
      }),
      onPlanUpdate: guardFwd((p: any) => {
        if (p.phase !== "update") return;
        const line = formatChannelProgressDraftLine({
          event: "plan",
          phase: p.phase,
          title: p.title,
          explanation: p.explanation,
          steps: p.steps,
        });
        if (line) progressDraft.pushToolProgress(line);
      }),
      onApprovalEvent: guardFwd((p: any) => {
        if (p.phase !== "requested") return;
        const line = formatChannelProgressDraftLine({
          event: "approval",
          phase: p.phase,
          title: p.title,
          command: p.command,
          reason: p.reason,
          message: p.message,
        });
        if (line) progressDraft.pushToolProgress(line);
      }),
      onCommandOutput: guardFwd((p: any) => {
        if (p.phase !== "end") return;
        const line = formatChannelProgressDraftLine({
          event: "command-output",
          phase: p.phase,
          title: p.title,
          name: p.name,
          status: p.status,
          exitCode: p.exitCode,
        });
        if (line) progressDraft.pushToolProgress(line);
      }),
      onPatchSummary: guardFwd((p: any) => {
        if (p.phase !== "end") return;
        const line = formatChannelProgressDraftLine({
          event: "patch",
          phase: p.phase,
          title: p.title,
          name: p.name,
          added: p.added,
          modified: p.modified,
          deleted: p.deleted,
          summary: p.summary,
        });
        if (line) progressDraft.pushToolProgress(line);
      }),
      onCompactionStart: guardFwd(() => {
        progressDraft.pushToolProgress("📦 **Compacting context...**", { startImmediately: true });
      }),
      onCompactionEnd: guardFwd(() => {
        progressDraft.reset();
      }),
      onAssistantMessageStart: guardFwd(() => {
        progressDraft.reset();
      }),
    };

    await new Promise<void>((resolve) => setTimeout(resolve, 1)); // yield for WS typing frame
    const coveMdChannelId = await resolveCoveMdChannelId(restClient, channelId);
    const coveMdContent = await getCoveMd(restClient, coveMdChannelId, log);
    const fullAttachmentUrls = collectImageAttachmentUrls(message, account.baseUrl);
    const bodyForAgent = buildBodyForAgent(message, fullAttachmentUrls, account.baseUrl);

    try {
      const messageId = message.id ?? `cove-${Date.now()}`;
      const ctxPayload = {
        Body: message.content, BodyForAgent: bodyForAgent,
        CommandBody: message.content, RawBody: message.content,
        From: senderId, To: channelId, ChannelId: channelId,
        SessionKey: `agent:${targetAgent}:cove:group:${channelId}`,
        AgentId: targetAgent, AccountId: accountId, MessageSid: messageId,
        Provider: "cove", Surface: "cove", ChatType: "channel",
        SenderId: senderId, SenderName: senderName, CommandAuthorized: false,
        ...((message as any).batchMeta ? {
          MessageSids: (message as any).batchMeta.MessageSids,
          MessageSidFirst: (message as any).batchMeta.MessageSidFirst,
          MessageSidLast: (message as any).batchMeta.MessageSidLast,
        } : {}),
        ...(coveMdContent ? { GroupSystemPrompt: "Channel rules from cove.md (channel-editable):\n\n" + coveMdContent + "\n\nCove: cross-channel messaging uses webhooks, not direct bot messages. Read the cove-ops skill for API details." } : {}),
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
            runDispatch: async () => {
              await typingCallbacks.onReplyStart?.();
              return originalDispatcher({ ctx: ctxPayload, cfg, dispatcherOptions, replyOptions });
            },
            log: (event: any) => { if (event.event === "error") log?.error?.(`cove: turn error in [${channelId}]: ${event.error}`); },
          }),
        },
      });
    } catch (err: any) {
      if (abortSignal?.aborted) {
        log?.info?.(`cove: dispatch aborted in [${channelId}]`);
      } else { throw err; }
    } finally {
      // Orphaned draft cleanup (Discord parity)
      // Runs when final delivery never happened — delete stale progress preview
      // so user doesn't see it frozen. Runs regardless of abort state.
      if (!finalReplyDelivered && !finalizedViaPreviewMessage && draftMessageId) {
        log?.warn?.(`cove: cleaning up orphaned draft ${draftMessageId} in [${channelId}] (message: ${message.id}, aborted: ${isAborted()})`);
        await draft.discardPending();
        await restClient.deleteMessage(channelId, draftMessageId).catch((e: any) =>
          log?.warn?.(`cove: failed to delete orphaned draft: ${e.message}`)
        );
      }
    }
  } catch (err: any) {
    log?.error?.(`cove: error in [${channelId}]: ${err.message}`);
  } finally {
    // Typing cleanup as safety net — covers success, error, abort, and supersede.
    // In the success path, deliver() already calls onCleanup early (before final message)
    // so the indicator stops promptly; this final call is idempotent insurance.
    typingCallbacks.onCleanup?.();
  }
}
