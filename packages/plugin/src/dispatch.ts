/** Cove message dispatch — inbound turn, draft streaming, tool progress, final delivery. */
import { type CoveAccount, COVE_TEXT_CHUNK_LIMIT } from "./types.js";
import type { CoveRestClient } from "./rest-client.js";
import type { AgentRunEventType, Message } from "@cove/shared";
import { createTypingCallbacks, deliverWithFinalizableLivePreviewAdapter, defineFinalizableLivePreviewAdapter } from "openclaw/plugin-sdk/channel-message";
import { createFinalizableDraftLifecycle } from "openclaw/plugin-sdk/channel-lifecycle";
import { createChannelProgressDraftCompositor, formatChannelProgressDraftLineForEntry, formatChannelProgressDraftLine, buildChannelProgressDraftLineForEntry } from "openclaw/plugin-sdk/channel-outbound";
import { defineStableChannelIngressIdentity, resolveChannelMessageIngress } from "openclaw/plugin-sdk/channel-ingress-runtime";
import { isControlCommandMessage, shouldComputeCommandAuthorized } from "openclaw/plugin-sdk/command-detection";
import { isAbortRequestText } from "openclaw/plugin-sdk/command-primitives-runtime";
import { resolveThreadSessionKeys } from "openclaw/plugin-sdk/routing";
import { getCoveMd } from "./cove-md-cache.js";
import { resolveThreadContext, isTaskThread, collectImageAttachmentUrls, buildBodyForAgent } from "./build-context.js";
import { createCoveOutboundBridgeAdapter } from "./outbound.js";
import { coveAgentRunLifecycleBridge } from "./agent-run-lifecycle.js";

const loadInbound = () => import("openclaw/plugin-sdk/inbound-reply-dispatch");
const coveIngressIdentity = defineStableChannelIngressIdentity();

export interface DispatchMessageOptions {
  message: Message; account: CoveAccount;
  restClient: CoveRestClient; channelRuntime: any; cfg: any;
  accountId: string; abortSignal?: AbortSignal; onAuthorizedAbort?: () => void; onAbortRejected?: () => void;
  log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void; error?: (...a: any[]) => void };
}

export async function dispatchMessage(opts: DispatchMessageOptions): Promise<void> {
  const { message, account, restClient, channelRuntime, cfg, accountId, abortSignal, onAuthorizedAbort, onAbortRejected, log } = opts;
  const channelId = message.channel_id;
  const senderId = message.author.id;
  const senderName = message.author.global_name || message.author.username;

  const isAborted = () => Boolean(abortSignal?.aborted);
  restClient.sendTyping(channelId, true).catch(() => {});

  const typingCallbacks = createTypingCallbacks({
    start: () => restClient.sendTyping(channelId, true),
    keepaliveIntervalMs: 5000, maxDurationMs: 60000,
    onStartError: (err) => log?.warn?.(`cove: typing start error in [${channelId}]: ${err}`),
  });

  try { // typing lifecycle: finally guarantees cleanup on all exit paths
    const { runInboundReplyTurn } = await loadInbound();
    const { coveMdChannelId, channel } = await resolveThreadContext(restClient, channelId);
    const taskThread = await isTaskThread(restClient, channelId, channel);
    const routePeer = { kind: taskThread ? "direct" as const : "channel" as const, id: channelId };
    const route = channelRuntime.routing?.resolveAgentRoute?.({
      cfg,
      channel: "cove",
      accountId,
      peer: routePeer,
      ...(channel?.type === 11 && channel.parent_id ? {
        parentPeer: { kind: "channel" as const, id: channel.parent_id },
      } : {}),
    }) ?? {
      agentId: account.agentId,
      sessionKey: `agent:${account.agentId}:cove:${routePeer.kind}:${channelId}`,
      mainSessionKey: `agent:${account.agentId}:main`,
    };
    const parentRoute = taskThread && channel?.parent_id
      ? channelRuntime.routing?.resolveAgentRoute?.({
        cfg,
        channel: "cove",
        accountId,
        peer: { kind: "channel" as const, id: channel.parent_id },
      })
      : undefined;
    const threadSession = taskThread
      ? resolveThreadSessionKeys({
        baseSessionKey: route.sessionKey,
        threadId: channelId,
        parentSessionKey: parentRoute?.sessionKey ?? route.mainSessionKey,
      })
      : { sessionKey: route.sessionKey, parentSessionKey: undefined };
    const targetAgent = route.agentId;
    const originalDispatcher = channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher;
    const recordInboundSession = channelRuntime.session.recordInboundSession.bind(channelRuntime.session);

    const draftState = { stopped: false, final: false };
    let draftMessageId: string | undefined;
    let lastSentText = "";
    let finalizedViaPreviewMessage = false;
    let undeliveredFinalPayload: string | undefined;
    let agentRun: { runId: string } | undefined;
    let taskEventQueue: Promise<void> = Promise.resolve();
    const reportTaskRunEvent = (event: { type: AgentRunEventType; tool_call_id?: string; action?: string; detail?: string; status?: string; exit_code?: number; duration_ms?: number; cwd?: string }) => {
      if (!agentRun) return;
      const run = agentRun;
      // Callback delivery is concurrent; serialize so a terminal event cannot overtake evidence.
      taskEventQueue = taskEventQueue.then(() => restClient.appendAgentRunEvent(run.runId, event)).then(() => undefined).catch((error) =>
        log?.warn?.(`cove: failed to report agent run event: ${error.message}`));
    };
    const associateAgentRunMessage = (assistantMessageId?: string) => {
      if (!agentRun || !assistantMessageId) return;
      taskEventQueue = taskEventQueue.then(() => restClient.associateAgentRunMessage(agentRun!.runId, assistantMessageId)).then(() => undefined).catch((error) =>
        log?.warn?.(`cove: failed to associate agent run message: ${error.message}`));
    };
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
        try {
          await restClient.deleteMessage(channelId, draftMessageId);
          draftMessageId = undefined;
        } catch (e: any) {
          log?.warn?.(`cove: failed to delete draft ${draftMessageId}: ${e.message}`);
        }
      }
      log?.info?.(`cove: reply → [${channelId}] (${text.length} chars)`);
      if (!outboundBridge.sendText) throw new Error("cove: outbound adapter missing sendText");
      try {
        const sent = await outboundBridge.sendText({ cfg, to: channelId, accountId, text });
        associateAgentRunMessage(sent?.messageId);
      } catch (e: any) {
        // Keep the payload on the failure object so the dispatcher/kernel can
        // retain it for recovery without claiming the reply was delivered.
        undeliveredFinalPayload = text;
        if (e && typeof e === "object") (e as { coveFinalPayload?: string }).coveFinalPayload = text;
        log?.warn?.(`cove: freshSend sendText failed for [${channelId}] (message: ${message.id}): ${e.message}`);
        throw e;
      }
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
          associateAgentRunMessage(id);
          finalizedViaPreviewMessage = true;
        }
        // Prevent pending throttle callbacks from overwriting the finalized message (openclaw/openclaw#118348)
        draftState.stopped = true;
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
        const directive = /(?:^|\n)\s*MEDIA:\s*`?([^\s`]+)`?\s*(?:\n|$)/i.exec(text);
        const mediaUrl = payload.mediaUrl ?? payload.mediaUrls?.[0] ?? directive?.[1];
        const caption = directive ? text.replace(directive[0], "\n").trim() : text;
        if (mediaUrl) {
          if (draftMessageId) {
            await restClient.deleteMessage(channelId, draftMessageId);
            draftMessageId = undefined;
          }
          if (!outboundBridge.sendMedia) throw new Error("cove: outbound adapter missing sendMedia");
          const delivered = await outboundBridge.sendMedia({ cfg, to: channelId, accountId, text: caption, mediaUrl });
          associateAgentRunMessage(delivered?.messageId);
          progressDraft.markFinalReplyDelivered();
          return;
        }
        if (!text) {
          // info not warn — empty text is legitimate for tool-only turns
          log?.info?.(`cove: deliver called with empty text for [${channelId}] (message: ${message.id})`);
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
      },
    };

    const replyOptions = {
      disableBlockStreaming: false,
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
        let args: string | undefined;
        try { args = typeof p?.args === "string" ? p.args : JSON.stringify(p?.args ?? {}); } catch { args = "[unserializable arguments]"; }
        reportTaskRunEvent({ type: "tool_started", tool_call_id: p?.toolCallId ?? p?.id, action: name, detail: args });
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
        const childType = p?.kind === "subagent"
          ? (p?.phase === "start" || p?.status === "started" || p?.status === "running" ? "subagent_started" : p?.status === "failed" ? "subagent_failed" : p?.phase === "end" || p?.status === "completed" ? "subagent_finished" : "subagent_progress")
          : "tool_progress";
        // These events are deliberately appended to the parent run: native
        // subagents do not emit a separate Cove inbound message, so this is the
        // durable parent-thread liveness signal until their work completes.
        reportTaskRunEvent({ type: childType, tool_call_id: p?.itemId, action: p?.title ?? p?.name ?? "Subagent", detail: p?.progressText ?? p?.summary, status: p?.status });
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
        reportTaskRunEvent({ type: "tool_progress", action: p?.title ?? "Plan update", detail: p?.explanation });
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
        reportTaskRunEvent({ type: "approval_requested", action: p?.title, detail: p?.message ?? p?.reason });
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
        reportTaskRunEvent({ type: p?.status === "failed" || (typeof p?.exitCode === "number" && p.exitCode !== 0) ? "tool_failed" : "command_output", tool_call_id: p?.toolCallId ?? p?.id, action: p?.title ?? p?.name, detail: p?.output, status: p?.status, exit_code: p?.exitCode, duration_ms: p?.durationMs, cwd: p?.cwd });
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
        reportTaskRunEvent({ type: "patch_summary", tool_call_id: p?.toolCallId ?? p?.id, action: p?.title ?? p?.name, detail: p?.summary ?? [p?.added?.length ? `added: ${p.added.join(", ")}` : "", p?.modified?.length ? `modified: ${p.modified.join(", ")}` : "", p?.deleted?.length ? `deleted: ${p.deleted.join(", ")}` : ""].filter(Boolean).join("; ") });
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
    const chatType = taskThread ? "direct" : "channel";
    // Match OpenClaw's full control-message predicate, including plain abort
    // triggers such as "stop" and "interrupt", not just slash commands.
    const controlCommand = isControlCommandMessage(message.content, cfg);
    const ingress = await resolveChannelMessageIngress({
      channelId: "cove",
      accountId,
      identity: coveIngressIdentity,
      subject: { stableId: senderId },
      conversation: { kind: "channel", id: channelId, ...(channel?.parent_id ? { parentId: channel.parent_id } : {}) },
      event: { kind: "message", authMode: "inbound", mayPair: false },
      policy: {
        dmPolicy: account.dmPolicy === "pairing" || account.dmPolicy === "allowlist" || account.dmPolicy === "disabled" ? account.dmPolicy : "open",
        groupPolicy: account.groupPolicy === "allowlist" || account.groupPolicy === "disabled" ? account.groupPolicy : "open",
      },
      allowFrom: account.allowFrom,
      groupAllowFrom: account.groupAllowFrom,
      command: {
        allowTextCommands: true,
        hasControlCommand: controlCommand,
        useAccessGroups: cfg?.commands?.useAccessGroups !== false,
        commandOwnerAllowFrom: account.allowFrom,
        commandGroupAllowFromFallbackToAllowFrom: true,
      },
      accessGroups: cfg?.accessGroups,
    });
    if (ingress.ingress.admission !== "dispatch") {
      log?.info?.(`cove: dropping inbound message in [${channelId}] (${ingress.ingress.reasonCode})`);
      return;
    }
    const commandAuthorized = shouldComputeCommandAuthorized(message.content, cfg)
      ? ingress.commandAccess.authorized
      : false;
    const isAbortRequest = isAbortRequestText(message.content);
    // This aborts only Cove's presentation controller after OpenClaw has made
    // the authorization decision. The actual agent/session cancellation below
    // still goes through runInboundReplyTurn and the standard fast-abort path.
    if (isAbortRequest) {
      if (commandAuthorized) onAuthorizedAbort?.();
      else onAbortRejected?.();
    }

    // Admission must complete before doing per-message enrichment, because
    // dropped messages should not read channel state or process attachments.
    // An accepted abort turn only needs its raw command and session identity;
    // skipping enrichment lets OpenClaw's fast-abort path run immediately.
    const skipEnrichment = isAbortRequest;
    // Every admitted Cove turn receives a generic ledger run. Task context is a
    // relation only, so normal channels and DMs get the same evidence trail.
    try {
      const task = taskThread ? await restClient.getTaskByThreadId(channelId) : null;
      // Task-thread runs use the task's parent channel as their durable
      // permission/index anchor; evidence and UI remain scoped by thread_id.
      const run = await restClient.startAgentRun({ channel_id: task?.channel_id ?? channel?.parent_id ?? channelId, trigger_message_id: message.id ?? `cove-${Date.now()}`, ...(taskThread ? { thread_id: channelId } : {}), ...(task ? { task_id: task.task_id } : {}) });
      agentRun = { runId: run.run_id };
      coveAgentRunLifecycleBridge.bindParent(threadSession.sessionKey, run.run_id, reportTaskRunEvent);
    } catch (error: any) {
      // Observability must never turn an otherwise valid agent turn into failure.
      log?.warn?.(`cove: failed to start agent run: ${error.message}`);
    }
    const coveMdContent = skipEnrichment ? null : await getCoveMd(restClient, coveMdChannelId, log);
    const fullAttachmentUrls = skipEnrichment ? [] : collectImageAttachmentUrls(message, account.baseUrl);
    const bodyForAgent = skipEnrichment
      ? message.content
      : buildBodyForAgent(message, fullAttachmentUrls, account.baseUrl);

    try {
      const messageId = message.id ?? `cove-${Date.now()}`;
      const ctxPayload = {
        Body: message.content, BodyForAgent: bodyForAgent,
        CommandBody: message.content, RawBody: message.content,
        From: senderId, To: channelId, ChannelId: channelId,
        SessionKey: threadSession.sessionKey,
        AgentId: targetAgent, AccountId: accountId, MessageSid: messageId,
        Provider: "cove", Surface: "cove", ChatType: chatType,
        SenderId: senderId, SenderName: senderName, CommandAuthorized: commandAuthorized,
        // The dispatcher only treats an authorized text command as an explicit
        // command turn when its source is set. This lets its standard fast-abort
        // path resolve and cancel the active SessionKey run.
        ...(commandAuthorized && controlCommand ? { CommandSource: "text" } : {}),
        ...(taskThread ? {
          MessageThreadId: channelId,
          ParentSessionKey: threadSession.parentSessionKey,
        } : {}),
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
            routeSessionKey: threadSession.sessionKey,
            storePath: "", ctxPayload, recordInboundSession,
            runDispatch: async () => {
              await typingCallbacks.onReplyStart?.();
              return originalDispatcher({ ctx: ctxPayload, cfg, dispatcherOptions, replyOptions });
            },
            log: (event: any) => { if (event.event === "error") log?.error?.(`cove: turn error in [${channelId}]: ${event.error}`); },
          }),
        },
      });
      // Native sessions_spawn children may outlive the parent reply dispatcher.
      // Keep this ledger active until OpenClaw emits their terminal lifecycle hook.
      await coveAgentRunLifecycleBridge.waitForChildren(threadSession.sessionKey, abortSignal);
      if (abortSignal?.aborted) throw new Error("cove: dispatch aborted while awaiting child session");
      reportTaskRunEvent({ type: "run_finished", action: "Completed" });
      await taskEventQueue;
    } catch (err: any) {
      if (abortSignal?.aborted) {
        reportTaskRunEvent({ type: "run_aborted", action: "Aborted" });
        await taskEventQueue;
        log?.info?.(`cove: dispatch aborted in [${channelId}]`);
      } else {
        reportTaskRunEvent({ type: "run_failed", action: "Failed" });
        await taskEventQueue;
        throw err;
      }
    } finally {
      // Orphaned draft cleanup (Discord parity)
      // Retry any preview that could not be deleted before non-in-place finalization.
      // Runs regardless of abort state.
      if (!finalizedViaPreviewMessage && draftMessageId) {
        log?.warn?.(`cove: cleaning up orphaned draft ${draftMessageId} in [${channelId}] (message: ${message.id}, aborted: ${isAborted()})`);
        await draft.discardPending();
        await restClient.deleteMessage(channelId, draftMessageId).catch((e: any) =>
          log?.warn?.(`cove: failed to delete orphaned draft (message: ${message.id}): ${e.message}`)
        );
      }
      if (undeliveredFinalPayload) {
        log?.warn?.(`cove: final reply remains recoverable after failed delivery in [${channelId}] (message: ${message.id}, ${undeliveredFinalPayload.length} chars)`);
      }
      coveAgentRunLifecycleBridge.unbindParent(threadSession.sessionKey);
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
