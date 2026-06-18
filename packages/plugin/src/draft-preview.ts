/**
 * Cove Layer 2 — Draft preview controller.
 *
 * Structurally identical to Discord's `createDiscordDraftPreviewController`.
 * Manages progress lines, partial text, and finalization by wrapping
 * the Layer 1 draft stream and the SDK compositor.
 *
 * Omitted Discord-specific features:
 * - Table conversion (`convertMarkdownTables`)
 * - Mention rewriting
 * - PluralKit / bot-loop protection
 * - Embed suppression flags
 * - Block-mode chunking (`EmbeddedBlockChunker` / `draftChunker`)
 */
import type { CoveRestClient } from "./rest-client.js";
import { createCoveDraftStream } from "./draft-stream.js";
import {
  createChannelProgressDraftCompositor,
  resolveChannelPreviewStreamMode,
  resolveChannelStreamingBlockEnabled,
  resolveChannelStreamingPreviewToolProgress,
  resolveChannelStreamingSuppressDefaultToolProgressMessages,
  type StreamingCompatEntry,
  type ChannelProgressDraftLine,
} from "openclaw/plugin-sdk/channel-message";
import {
  stripReasoningTagsFromText,
  stripInlineDirectiveTagsForDelivery,
} from "openclaw/plugin-sdk/text-runtime";

type ProgressDraftLine = string | ChannelProgressDraftLine;

/** Max chars for Cove draft preview messages. */
const COVE_PREVIEW_MAX_CHARS = 4000;

function isEmptyCoveProgressLine(line: ProgressDraftLine | undefined): boolean {
  if (!line || typeof line === "string") return false;
  return (line as ChannelProgressDraftLine).toolName === "apply_patch"
    && !(line as ChannelProgressDraftLine).detail
    && !(line as ChannelProgressDraftLine).status;
}

function shouldStartCoveProgressDraftNow(line: ProgressDraftLine | undefined): boolean {
  return typeof line === "object"
    && (line as ChannelProgressDraftLine)?.kind === "patch"
    && Boolean((line as ChannelProgressDraftLine).detail);
}

export function createCoveDraftPreviewController(params: {
  cfg: any;
  channelConfig: StreamingCompatEntry | null | undefined;
  accountId: string;
  sourceRepliesAreToolOnly: boolean;
  textLimit: number;
  restClient: CoveRestClient;
  deliverChannelId: string;
  replyReference: { peek: () => string | undefined };
  log: (msg: string) => void;
}) {
  // 1. Resolve stream mode
  const streamMode = resolveChannelPreviewStreamMode(params.channelConfig, "partial");
  const draftMaxChars = Math.min(params.textLimit, COVE_PREVIEW_MAX_CHARS);

  // 2. Check block streaming override
  const accountBlockStreamingEnabled =
    resolveChannelStreamingBlockEnabled(params.channelConfig)
    ?? params.cfg.agents?.defaults?.blockStreamingDefault === "on";

  // 3. Decide if streaming for tool-only sources
  const canStreamProgressDraftForToolOnlySource =
    params.sourceRepliesAreToolOnly && streamMode === "progress";

  // 4. Create draft stream (conditionally)
  const draftStream =
    (!params.sourceRepliesAreToolOnly || canStreamProgressDraftForToolOnlySource)
    && streamMode !== "off"
    && !accountBlockStreamingEnabled
      ? createCoveDraftStream({
          restClient: params.restClient,
          channelId: params.deliverChannelId,
          maxChars: draftMaxChars,
          replyToMessageId: () => params.replyReference.peek(),
          minInitialChars: streamMode === "progress" ? 0 : 30,
          throttleMs: 1200,
          log: params.log,
          warn: params.log,
        })
      : undefined;

  // --- Mutable state (mirrors Discord) ---
  let lastPartialText = "";
  let draftText = "";
  let hasStreamedMessage = false;
  let finalizedViaPreviewMessage = false;
  let finalReplyDelivered = false;

  // 5. Resolve preview tool progress flags
  const previewToolProgressEnabled =
    Boolean(draftStream) && resolveChannelStreamingPreviewToolProgress(params.channelConfig);
  const suppressDefaultToolProgressMessages =
    Boolean(draftStream) && resolveChannelStreamingSuppressDefaultToolProgressMessages(params.channelConfig, {
      draftStreamActive: true,
      previewToolProgressEnabled,
    });

  // 6. Wire compositor (SDK)
  const progressSeed = `${params.accountId}:${params.deliverChannelId}`;
  const progressDraft = createChannelProgressDraftCompositor({
    entry: params.channelConfig,
    mode: streamMode,
    active: Boolean(draftStream),
    seed: progressSeed,

    update: async (previewText, options) => {
      lastPartialText = previewText;
      draftText = previewText;
      hasStreamedMessage = true;
      draftStream?.update(previewText);
      if (options?.flush) await draftStream?.flush();
    },

    deleteCurrent: async () => {
      lastPartialText = "";
      draftText = "";
      hasStreamedMessage = false;
      if (draftStream?.messageId()) await draftStream.deleteCurrentMessage();
    },

    isEmptyLine: isEmptyCoveProgressLine,
    shouldStartNow: shouldStartCoveProgressDraftNow,
  });

  const resetProgressState = () => {
    lastPartialText = "";
    draftText = "";
    progressDraft.reset();
  };

  // --- Return controller ---
  return {
    draftStream,
    previewToolProgressEnabled,
    commentaryProgressEnabled: progressDraft.commentaryProgressEnabled,
    suppressDefaultToolProgressMessages,

    get isProgressMode() {
      return streamMode === "progress";
    },
    get hasProgressDraftStarted() {
      return progressDraft.hasStarted;
    },
    get finalizedViaPreviewMessage() {
      return finalizedViaPreviewMessage;
    },

    markFinalReplyStarted() {
      progressDraft.markFinalReplyStarted();
    },
    markFinalReplyDelivered() {
      finalReplyDelivered = true;
      progressDraft.markFinalReplyDelivered();
    },
    markPreviewFinalized() {
      finalizedViaPreviewMessage = true;
    },

    disableBlockStreamingForDraft: draftStream ? true : undefined,

    async startProgressDraft() {
      if (!draftStream || streamMode !== "progress") return;
      await progressDraft.start();
    },
    async pushToolProgress(line: ProgressDraftLine | undefined, options?: { toolName?: string; startImmediately?: boolean }) {
      await progressDraft.pushToolProgress(line, options);
    },
    async pushReasoningProgress(text: string | undefined, options?: { snapshot?: boolean }) {
      await progressDraft.pushReasoningProgress(text, options);
    },
    async pushCommentaryProgress(text: string | undefined, options?: { itemId?: string }) {
      await progressDraft.pushCommentaryProgress(text, options);
    },

    resolvePreviewFinalText(text: unknown): string | undefined {
      if (typeof text !== "string") return;
      const formatted = stripInlineDirectiveTagsForDelivery(text).text;

      // Cove: no table conversion, no Discord chunking.
      // Just check if the text fits within draftMaxChars.
      if (!formatted) return;
      const trimmed = formatted.trim();
      if (!trimmed) return;
      if (trimmed.length > draftMaxChars) return;

      // Dedup check: don't regress if current preview is a superset.
      const currentPreviewText = lastPartialText;
      if (currentPreviewText && currentPreviewText.startsWith(trimmed) && trimmed.length < currentPreviewText.length) return;

      return trimmed;
    },

    updateFromPartial(text: string | undefined) {
      if (!draftStream || !text) return;

      const cleaned = stripInlineDirectiveTagsForDelivery(
        stripReasoningTagsFromText(text, { mode: "strict", trim: "both" }),
      ).text;

      if (!cleaned || cleaned.startsWith("Reasoning:\n")) return;
      if (cleaned === lastPartialText) return;
      if (streamMode === "progress") return;

      progressDraft.suppress();
      hasStreamedMessage = true;

      // Cove only supports "partial" mode (no block-mode chunking).
      // Partial-mode: regression guard then direct update.
      if (lastPartialText && lastPartialText.startsWith(cleaned) && cleaned.length < lastPartialText.length) return;
      lastPartialText = cleaned;
      draftText = cleaned;
      draftStream.update(cleaned);
    },

    handleAssistantMessageBoundary() {
      if (streamMode === "progress") return;
      // No block-mode split (forceNewMessage) — just reset progress state.
      resetProgressState();
    },

    async flush() {
      if (!draftStream) return;
      // No block-mode chunker to drain.
      await draftStream.flush();
    },

    async cleanup() {
      try {
        progressDraft.cancel();
        if (!finalReplyDelivered) await draftStream?.discardPending();
        if (!finalReplyDelivered && !finalizedViaPreviewMessage && draftStream?.messageId()) {
          await draftStream.clear();
        }
      } catch (err) {
        params.log(`cove: draft cleanup failed: ${String(err)}`);
      }
    },
  };
}
