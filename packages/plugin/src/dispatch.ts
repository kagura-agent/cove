/** Cove message dispatch — inbound turn, draft streaming, tool progress, final delivery. */
import { type CoveAccount, COVE_TEXT_CHUNK_LIMIT } from "./types.js";
import type { CoveRestClient } from "./rest-client.js";
import type { Message } from "@cove/shared";
import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-message";
import { createFinalizableDraftLifecycle } from "openclaw/plugin-sdk/channel-lifecycle";
import { createToolProgressTracker } from "./tool-progress.js";
import { getCoveMd } from "./cove-md-cache.js";
import { resolveCoveMdChannelId, collectImageAttachmentUrls, buildBodyForAgent } from "./build-context.js";

const loadInbound = () => import("openclaw/plugin-sdk/inbound-reply-dispatch");
export interface DispatchMessageOptions {
  message: Message; batchedMessages?: Message[]; account: CoveAccount;
  restClient: CoveRestClient; channelRuntime: any; cfg: any;
  accountId: string; pendingDispatches: Map<string, AbortController>;
  log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void; error?: (...a: any[]) => void };
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
    keepaliveIntervalMs: 5000, maxDurationMs: 60000,
    onStartError: (err) => log?.warn?.(`cove: typing start error in [${channelId}]: ${err}`),
  });

  try {
    const { runInboundReplyTurn } = await loadInbound();
    const targetAgent = account.agentId;
    const originalDispatcher = channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher;
    const recordInboundSession = channelRuntime.session.recordInboundSession.bind(channelRuntime.session);

    const draftState = { stopped: false, final: false };
    let draftMessageId: string | undefined;
    let lastSentText = "";
    const channelEntry = cfg?.channels?.["cove"] ?? {};
    const toolProgress = createToolProgressTracker(channelEntry, {
      seed: message.id ?? String(Date.now()),
      onProgressUpdate: () => { const c = toolProgress.getCombinedText(); if (c) draft.update(c); },
    });

    let editQueue = Promise.resolve();
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

    /** Clean up orphaned draft and send fresh message (direct REST, no SDK indirection). */
    const freshSend = async (text: string) => {
      if (draftMessageId) {
        try { await restClient.deleteMessage(channelId, draftMessageId); }
        catch (e: any) { log?.warn?.(`cove: failed to delete draft ${draftMessageId}: ${e.message}`); }
      }
      log?.info?.(`cove: reply → [${channelId}] (${text.length} chars)`);
      await restClient.sendMessage(channelId, text);
    };

    const guardFwd = (fn: (...a: any[]) => void) => (...a: any[]) => { if (isCurrent()) fn(...a); };

    const dispatcherOptions = {
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
          try { await restClient.editMessage(channelId, draftMessageId, text); }
          catch (e: any) { log?.warn?.(`cove: final edit failed: ${e.message}`); await freshSend(text); }
        } else {
          await freshSend(text);
        }
      },
    };

    const replyOptions = {
      disableBlockStreaming: true, suppressDefaultToolProgressMessages: true,
      onPartialReply: (p: any) => { if (!isCurrent() || !p?.text) return; toolProgress.onPartialReply(p.text); draft.update(p.text); },
      onToolStart: (p: any) => { if (!isCurrent()) return; toolProgress.onToolStart({ name: p?.name ?? p?.toolName, args: p?.args, phase: p?.phase, detailMode: p?.detailMode }); },
      onItemEvent: guardFwd((p: any) => toolProgress.onItemEvent(p)),
      onPlanUpdate: guardFwd((p: any) => toolProgress.onPlanUpdate(p)),
      onApprovalEvent: guardFwd((p: any) => toolProgress.onApprovalEvent(p)),
      onCommandOutput: guardFwd((p: any) => toolProgress.onCommandOutput(p)),
      onPatchSummary: guardFwd((p: any) => toolProgress.onPatchSummary(p)),
      onCompactionStart: guardFwd(() => { toolProgress.onCompactionStart(); const c = toolProgress.getCombinedText(); if (c) draft.update(c); }),
      onCompactionEnd: guardFwd(() => toolProgress.onCompactionEnd()),
      onAssistantMessageStart: guardFwd(() => toolProgress.onAssistantMessageStart()),
    };

    await new Promise<void>((resolve) => setTimeout(resolve, 1)); // yield for WS typing frame
    const coveMdChannelId = await resolveCoveMdChannelId(restClient, channelId);
    const coveMdContent = await getCoveMd(restClient, coveMdChannelId, log);
    const fullAttachmentUrls = collectImageAttachmentUrls(message, batchedMessages, account.baseUrl);
    const bodyForAgent = buildBodyForAgent(message, batchedMessages, fullAttachmentUrls, account.baseUrl);

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
    } catch (err: any) {
      if (abortController.signal.aborted) {
        typingCallbacks.onCleanup?.();
        log?.info?.(`cove: dispatch aborted in [${channelId}]`);
      } else { throw err; }
    } finally {
      if (pendingDispatches.get(channelId) === abortController) pendingDispatches.delete(channelId);
    }
  } catch (err: any) {
    typingCallbacks.onCleanup?.();
    log?.error?.(`cove: error in [${channelId}]: ${err.message}`);
  }
}
