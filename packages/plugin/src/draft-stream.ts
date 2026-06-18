/**
 * Cove Layer 1 — Draft stream.
 *
 * Structurally identical to Discord's `createDiscordDraftStream`.
 * Sends-or-edits a single platform message with throttle/dedup,
 * delegating lifecycle management to `createFinalizableDraftLifecycle`.
 */
import type { CoveRestClient } from "./rest-client.js";
import {
  createFinalizableDraftLifecycle,
  type FinalizableDraftStreamState,
  type DraftStreamLoop,
} from "openclaw/plugin-sdk/channel-message";

/** Cove messages cap at 4000 characters. */
const COVE_STREAM_MAX_CHARS = 4000;
const DEFAULT_THROTTLE_MS = 1200;

export function createCoveDraftStream(params: {
  restClient: CoveRestClient;
  channelId: string;
  maxChars?: number;
  throttleMs?: number;
  minInitialChars?: number;
  replyToMessageId?: string | (() => string | undefined);
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}): {
  update: (text: string) => void;
  flush: () => Promise<void>;
  messageId: () => string | undefined;
  clear: () => Promise<void>;
  deleteCurrentMessage: () => Promise<void>;
  discardPending: () => Promise<void>;
  seal: () => Promise<void>;
  stop: () => void;
  forceNewMessage: () => void;
} {
  const maxChars = Math.min(params.maxChars ?? COVE_STREAM_MAX_CHARS, COVE_STREAM_MAX_CHARS);
  const throttleMs = Math.max(250, params.throttleMs ?? DEFAULT_THROTTLE_MS);
  const minInitialChars = params.minInitialChars;
  const channelId = params.channelId;
  const restClient = params.restClient;

  const streamState: FinalizableDraftStreamState = { stopped: false, final: false };
  let streamMessageId: string | undefined;
  let lastSentText = "";

  const sendOrEditStreamMessage = async (text: string): Promise<boolean> => {
    if (streamState.stopped && !streamState.final) return false;
    const trimmed = text.trimEnd();
    if (!trimmed) return false;
    if (trimmed.length > maxChars) {
      streamState.stopped = true;
      params.warn?.(`cove stream preview stopped (text length ${trimmed.length} > ${maxChars})`);
      return false;
    }
    if (trimmed === lastSentText) return true;
    if (streamMessageId === undefined && minInitialChars != null && !streamState.final) {
      if (trimmed.length < minInitialChars) return false;
    }
    lastSentText = trimmed;
    try {
      if (streamMessageId !== undefined) {
        await restClient.editMessage(channelId, streamMessageId, trimmed);
        return true;
      }
      const sent = await restClient.sendMessage(channelId, trimmed);
      const sentMessageId = sent?.id;
      if (typeof sentMessageId !== "string" || !sentMessageId) {
        streamState.stopped = true;
        params.warn?.("cove stream preview stopped (missing message id from send)");
        return false;
      }
      streamMessageId = sentMessageId;
      return true;
    } catch (err) {
      streamState.stopped = true;
      params.warn?.(`cove stream preview failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  const readMessageId = () => streamMessageId;
  const clearMessageId = () => { streamMessageId = undefined; };
  const isValidStreamMessageId = (value: unknown): value is string => typeof value === "string";
  const deleteStreamMessage = async (messageId: string) => {
    await restClient.deleteMessage(channelId, messageId);
  };

  const { loop, update, stop, clear, discardPending, seal } = createFinalizableDraftLifecycle({
    throttleMs,
    state: streamState,
    sendOrEditStreamMessage,
    readMessageId,
    clearMessageId,
    isValidMessageId: isValidStreamMessageId,
    deleteMessage: deleteStreamMessage,
    warn: params.warn,
    warnPrefix: "cove stream preview cleanup failed",
  });

  const forceNewMessage = () => {
    streamMessageId = undefined;
    lastSentText = "";
    loop.resetPending();
  };

  const deleteCurrentMessage = async () => {
    loop.resetPending();
    await loop.waitForInFlight();
    const messageId = streamMessageId;
    streamMessageId = undefined;
    lastSentText = "";
    loop.resetThrottleWindow();
    if (!isValidStreamMessageId(messageId)) return;
    try {
      await deleteStreamMessage(messageId);
    } catch (err) {
      params.warn?.(`cove stream preview cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  params.log?.(`cove stream preview ready (maxChars=${maxChars}, throttleMs=${throttleMs})`);

  return {
    update,
    flush: loop.flush,
    messageId: () => streamMessageId,
    clear,
    deleteCurrentMessage,
    discardPending,
    seal,
    stop,
    forceNewMessage,
  };
}
