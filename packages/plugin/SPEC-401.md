# SPEC-401: Cove Draft Preview & Delivery — Discord Parity

> **Issue:** #401  
> **Status:** Draft  
> **Last updated:** 2026-06-18  
>
> Goal: Make the Cove plugin's draft preview, progress rendering, and final delivery
> structurally identical to Discord's three-layer architecture.

---

## 1. Discord Architecture

Discord's draft preview system has three layers, wired together inside
`processDiscordMessage`. Each layer has a single responsibility.

### 1.1 Layer 1 — `createDiscordDraftStream` (Bottom)

**File:** `extensions/discord/src/draft-stream.ts`  
**Responsibility:** Send-or-edit a single platform message with throttle/dedup.

#### Constants

```ts
const DISCORD_STREAM_MAX_CHARS = 2000;
const DEFAULT_THROTTLE_MS = 1200;
const DISCORD_PREVIEW_ALLOWED_MENTIONS = { parse: [] };
```

#### Parameters

```ts
function createDiscordDraftStream(params: {
  rest: DiscordRestClient;
  channelId: string;
  maxChars?: number;           // clamped to ≤ 2000
  throttleMs?: number;         // floor 250, default 1200
  minInitialChars?: number;    // skip first update until N chars accumulated
  replyToMessageId?: string | (() => string | undefined);
  suppressEmbeds?: boolean;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
})
```

#### Internal State

```ts
const streamState = { stopped: false, final: false };  // FinalizableDraftStreamState
let streamMessageId: string | undefined;
let lastSentText = "";
```

#### Core Logic — `sendOrEditStreamMessage(text)`

1. If `streamState.stopped && !streamState.final` → bail (return false)
2. Trim text; bail if empty
3. If `trimmed.length > maxChars` → set stopped, warn, bail
4. If `trimmed === lastSentText` → dedup, return true
5. If no message yet AND `minInitialChars` set AND not final → skip if too short
6. Set `lastSentText = trimmed`
7. If `streamMessageId` exists → **edit** the message (PATCH)
8. Else → **create** a new message (POST), capture `streamMessageId`
9. On any error → set stopped, warn, bail

The function is passed into `createFinalizableDraftLifecycle` (SDK), which wraps it
with a `DraftStreamLoop` providing:
- `update(text)` — queue text, throttled send
- `flush()` — force immediate send of pending
- `stop()` — mark stopped
- `seal()` — mark final, flush
- `clear()` — stop + delete the preview message
- `discardPending()` — drop pending text without sending

#### Additional Methods

```ts
forceNewMessage(): void
  // Reset streamMessageId + lastSentText + loop.resetPending
  // Used between assistant messages in block mode to start a new preview msg

deleteCurrentMessage(): Promise<void>
  // loop.resetPending → waitForInFlight → read+clear streamMessageId → delete
  // Used by progress draft compositor to remove stale previews
```

#### Return Shape

```ts
{
  update: (text: string) => void;
  flush: () => Promise<void>;
  messageId: () => string | undefined;
  clear: () => Promise<void>;
  deleteCurrentMessage: () => Promise<void>;
  discardPending: () => Promise<void>;
  seal: () => Promise<void>;
  stop: () => void;
  forceNewMessage: () => void;
}
```

---

### 1.2 Layer 2 — `createDiscordDraftPreviewController` (Middle)

**File:** `extensions/discord/src/monitor/message-handler.draft-preview.ts`  
**Responsibility:** Manage progress lines, partial text, chunking, finalization.
Wraps the draft stream and the SDK compositor.

#### Parameters

```ts
function createDiscordDraftPreviewController(params: {
  cfg: any;
  discordConfig: StreamingCompatEntry | null | undefined;
  accountId: string;
  sourceRepliesAreToolOnly: boolean;
  textLimit: number;
  deliveryRest: DiscordRestClient;
  deliverChannelId: string;
  replyReference: { peek: () => string | undefined };
  tableMode: string;
  maxLinesPerMessage: number;
  chunkMode: string;
  log: (msg: string) => void;
})
```

#### Initialization Logic

```ts
// 1. Resolve stream mode
const discordStreamMode = resolveDiscordPreviewStreamMode(params.discordConfig);
//    resolveDiscordPreviewStreamMode = resolveChannelPreviewStreamMode(entry, "partial")
//    Returns: "off" | "partial" | "progress" | "block"

// 2. Resolve text limit
const draftMaxChars = Math.min(params.textLimit, 2000);

// 3. Check block streaming override
const accountBlockStreamingEnabled =
  resolveChannelStreamingBlockEnabled(params.discordConfig) ??
  params.cfg.agents?.defaults?.blockStreamingDefault === "on";

// 4. Decide if streaming for tool-only sources
const canStreamProgressDraftForToolOnlySource =
  params.sourceRepliesAreToolOnly && discordStreamMode === "progress";

// 5. Create draft stream (conditionally)
const draftStream =
  (!params.sourceRepliesAreToolOnly || canStreamProgressDraftForToolOnlySource) &&
  discordStreamMode !== "off" &&
  !accountBlockStreamingEnabled
    ? createDiscordDraftStream({ ... })
    : undefined;

// 6. Block-mode chunking (only in block mode)
const draftChunking = draftStream && discordStreamMode === "block"
  ? resolveDiscordDraftStreamingChunking(params.cfg, params.accountId) : undefined;
const draftChunker = draftChunking
  ? new EmbeddedBlockChunker(draftChunking) : undefined;
const shouldSplitPreviewMessages = discordStreamMode === "block";
```

#### Mutable State

```ts
let lastPartialText = "";           // last raw partial from model
let draftText = "";                 // current text being streamed (for block mode accumulation)
let hasStreamedMessage = false;     // true once any text sent to draft stream
let finalizedViaPreviewMessage = false;  // true when final was delivered by editing preview
let finalReplyDelivered = false;    // true after final delivery confirmed
```

#### Progress Draft Compositor (SDK)

```ts
const progressDraft = createChannelProgressDraftCompositor({
  entry: params.discordConfig,
  mode: discordStreamMode,       // "off" | "partial" | "progress" | "block"
  active: Boolean(draftStream),
  seed: `${params.accountId}:${params.deliverChannelId}`,

  update: async (previewText, options) => {
    // Called by compositor when progress text changes
    lastPartialText = previewText;
    draftText = previewText;
    hasStreamedMessage = true;
    draftChunker?.reset();
    draftStream?.update(previewText);
    if (options?.flush) await draftStream?.flush();
  },

  deleteCurrent: async () => {
    // Called by compositor to remove stale preview
    lastPartialText = "";
    draftText = "";
    hasStreamedMessage = false;
    if (draftStream?.messageId()) await draftStream.deleteCurrentMessage();
  },

  isEmptyLine: isEmptyDiscordProgressLine,
  shouldStartNow: shouldStartDiscordProgressDraftNow,
});
```

The compositor provides:
- `start()` — begin progress rendering (delayed by gate unless shouldStartNow)
- `pushToolProgress(line, options)` — add a tool progress line
- `pushReasoningProgress(text, options)` — show reasoning indicator
- `pushCommentaryProgress(text, options)` — show preamble/commentary
- `markFinalReplyStarted()` / `markFinalReplyDelivered()` — finalization bookkeeping
- `reset()` — clear progress state
- `suppress()` — stop progress (when partial text arrives, progress is suppressed)
- `cancel()` — cancel pending progress timer
- `hasStarted` — getter, true if any progress was rendered
- `commentaryProgressEnabled` — getter
- `previewToolProgressEnabled` — readonly boolean
- `suppressDefaultToolProgressMessages` — readonly boolean

#### Discord-specific Progress Helpers

```ts
function isEmptyDiscordProgressLine(line): boolean {
  if (!line || typeof line === "string") return false;
  return line.toolName === "apply_patch" && !line.detail && !line.status;
}

function shouldStartDiscordProgressDraftNow(line): boolean {
  return typeof line === "object" && line?.kind === "patch" && Boolean(line.detail);
}
```

#### Key Methods on the Controller

**`updateFromPartial(text)`** — called by `onPartialReply`

```
1. Strip reasoning tags + inline directive tags
2. If empty or starts with "Reasoning:\n" → skip
3. If same as lastPartialText → dedup skip
4. If mode === "progress" → skip (progress mode doesn't show partials)
5. Suppress progress draft (compositor.suppress())
6. Set hasStreamedMessage = true

Mode "partial":
  - If old text starts with new (regression) → skip
  - Set lastPartialText = cleaned
  - draftStream.update(cleaned)

Mode "block":
  - Compute delta from lastPartialText
  - If cleaned doesn't start with lastPartialText → reset chunker + draftText
  - Update lastPartialText
  - If no chunker → draftText = cleaned, draftStream.update(draftText)
  - Else → chunker.append(delta), chunker.drain → draftText += chunk, draftStream.update(draftText)
```

**`handleAssistantMessageBoundary()`** — called on `onAssistantMessageStart` and `onReasoningEnd`

```
If mode !== "progress":
  If shouldSplitPreviewMessages && hasStreamedMessage:
    draftStream.forceNewMessage()  // start new Discord msg
  Reset progress state (lastPartialText, draftText, chunker, compositor)
```

**`resolvePreviewFinalText(text)`** — called during finalization

```
1. Format: convertMarkdownTables + stripInlineDirectiveTags
2. Chunk: chunkDiscordTextWithMode(formatted, { maxChars, maxLines, chunkMode })
3. Only returns text if exactly 1 chunk that fits in preview
4. Returns undefined if:
   - No text or empty after trim
   - Multiple chunks (too long for preview edit)
   - Current preview text is a superset (would be a regression)
```

**`flush()`**

```
1. If chunker has buffered → drain(force=true), append to draftText
2. If draftText → draftStream.update(draftText)
3. await draftStream.flush()
```

**`cleanup()`**

```
1. progressDraft.cancel()
2. If final not delivered → discardPending
3. If final not delivered AND not finalized via preview AND draft has messageId → clear (delete)
```

**`startProgressDraft()`**
- Only starts if draftStream exists AND mode === "progress"
- Calls `progressDraft.start()`

#### Return Shape

```ts
{
  draftStream: DraftStreamReturnType | undefined;
  previewToolProgressEnabled: boolean;
  commentaryProgressEnabled: boolean;
  suppressDefaultToolProgressMessages: boolean;
  isProgressMode: boolean;                    // getter
  hasProgressDraftStarted: boolean;           // getter → progressDraft.hasStarted
  finalizedViaPreviewMessage: boolean;        // getter
  markFinalReplyStarted(): void;
  markFinalReplyDelivered(): void;
  markPreviewFinalized(): void;
  disableBlockStreamingForDraft: true | undefined;
  startProgressDraft(): Promise<void>;
  pushToolProgress(line, options): Promise<void>;
  pushReasoningProgress(text, options): Promise<void>;
  pushCommentaryProgress(text, options): Promise<void>;
  resolvePreviewFinalText(text): string | undefined;
  updateFromPartial(text): void;
  handleAssistantMessageBoundary(): void;
  flush(): Promise<void>;
  cleanup(): Promise<void>;
}
```

---

### 1.3 Layer 3 — `deliverDiscordPayload` + Finalization Adapter (Top)

**File:** `extensions/discord/src/monitor/message-handler.process.ts`  
**Responsibility:** Decide whether to finalize the preview in-place or send normally.

#### Pre-delivery Filter — `beforeDiscordPayloadDelivery(payload, info)`

Called before delivery; returns null to skip or the payload to deliver.

```
1. If aborted → skip
2. If payload.isReasoning → skip
3. If draftStream active AND progress mode AND kind === "block"
   AND no media AND not error → skip (progress mode absorbs text blocks)
4. If kind === "final" AND not a fallback-only tool warning → markFinalReplyStarted
5. Return payload
```

#### Main Delivery — `deliverDiscordPayload(payload, info, options?)`

```ts
async function deliverDiscordPayload(
  payload: ReplyPayload,
  info: { kind: "tool" | "block" | "final" },
  options?: { allowFallbackOnlyToolWarning?: boolean }
): Promise<{ visibleReplySent: boolean }>
```

**Flow:**

1. Abort check → bail with `{ visibleReplySent: false }`
2. Reasoning payload → bail
3. Tool warning deferral:
   - If final AND fallback-only tool warning AND not explicitly allowed
   - Park in `pendingToolWarningFinal` for later delivery
4. Mark final reply started
5. **Transcript-backed final text resolution** (for final payloads):
   ```ts
   const finalText = isFinal ? await resolveTranscriptBackedChannelFinalText({
     finalText: payload.text,
     resolveCandidateText: resolveCurrentTurnTranscriptFinalText,
   }) : payload.text;
   ```
6. **Sanitize** payloads with `sanitizeDiscordFrontChannelReplyPayloads`
7. Progress-mode block suppression (same as pre-delivery filter)
8. **Live Preview Finalization Attempt** (the key logic):

   Condition: draftStream exists AND isFinal AND (not progress-mode OR progress has started) AND not error

   ```ts
   const adapter = defineFinalizableLivePreviewAdapter({
     draft: {
       flush: () => draftPreview.flush(),
       clear: () => draftStream.clear(),
       discardPending: () => draftStream.discardPending(),
       seal: () => draftStream.seal(),
       id: draftStream.messageId,
     },

     buildFinalEdit: () => {
       // Returns undefined (= can't finalize) if:
       //   - Already finalized via preview
       //   - Has media without TTS supplement
       //   - No previewFinalText resolved
       //   - Has explicit reply directive
       //   - Is error
       //   - Has targeted mention without broadcast mention
       // Otherwise returns: { content: previewFinalText, flags? }
     },

     editFinal: async (previewMessageId, edit) => {
       // Abort check, then edit the preview message in place
       await editMessageDiscord(deliverChannelId, previewMessageId, edit, { cfg, accountId, rest: deliveryRest });
     },

     onPreviewFinalized: () => {
       markUserFacingFinalDelivered();
       draftPreview.markPreviewFinalized();
       replyReference.markSent();
     },

     buildSupplementalPayload: () => {
       // If TTS supplement exists, build media-only payload
       return ttsSupplement ? buildTtsSupplementMediaPayload(deliverablePayload) : undefined;
     },

     deliverSupplemental: async (supplementalPayload) => {
       // Deliver extra media after preview finalization
       await deliverDiscordReply({ ... });
       return true;
     },

     logPreviewEditFailure: (err) => {
       logVerbose(`preview final edit failed; falling back to standard send (${err})`);
     },
   });
   ```

   Then call:
   ```ts
   const result = await deliverWithFinalizableLivePreviewAdapter({
     kind: info.kind,
     payload: deliverablePayload,
     adapter,
     deliverNormally: async () => {
       // Standard fresh send path
       await deliverDiscordReply({ cfg, replies: [payload], target, ... });
       return true;
     },
     onNormalDelivered: () => {
       markUserFacingFinalDelivered();
       replyReference.markSent();
     },
   });
   ```

9. If adapter returned something other than "normal-skipped" → return `{ visibleReplySent: true }`
10. Otherwise fall through to standard delivery:
    ```ts
    await deliverDiscordReply({ ... });
    replyReference.markSent();
    if (isFinal && !isError) markUserFacingFinalDelivered();
    ```

---

### 1.4 Reply Options Wiring

The three layers are connected via `replyOptions` passed to `dispatchChannelInboundReply`:

```ts
replyOptions: {
  abortSignal,
  disableBlockStreaming:
    sourceRepliesAreToolOnly ? true
    : draftPreview.disableBlockStreamingForDraft
      ?? (typeof resolvedBlockStreamingEnabled === "boolean"
        ? !resolvedBlockStreamingEnabled : undefined),

  // Partial text → Layer 2
  onPartialReply: draftPreview.draftStream && !draftPreview.isProgressMode
    ? (payload) => draftPreview.updateFromPartial(payload.text)
    : undefined,

  // Message boundaries → Layer 2
  onAssistantMessageStart: draftPreview.draftStream
    ? () => draftPreview.handleAssistantMessageBoundary()
    : undefined,
  onReasoningEnd: draftPreview.draftStream
    ? () => draftPreview.handleAssistantMessageBoundary()
    : undefined,

  // Tool progress → Layer 2 (compositor)
  suppressDefaultToolProgressMessages:
    draftPreview.suppressDefaultToolProgressMessages ? true : undefined,
  commentaryProgressEnabled:
    draftPreview.isProgressMode ? draftPreview.commentaryProgressEnabled : undefined,

  onReasoningStream: async (payload) => {
    await draftPreview.pushReasoningProgress(payload?.text, {
      snapshot: payload?.isReasoningSnapshot === true,
    });
  },

  onToolStart: async (payload) => {
    await draftPreview.pushToolProgress(
      buildChannelProgressDraftLineForEntry(discordConfig, {
        event: "tool", name: payload.name, phase: payload.phase, args: payload.args,
      }, payload.detailMode ? { detailMode: payload.detailMode } : undefined),
      { toolName: payload.name },
    );
  },

  onItemEvent: async (payload) => {
    if (payload.kind === "preamble") {
      if (verboseProgressActive()) return;
      if (draftPreview.commentaryProgressEnabled && payload.progressText)
        await draftPreview.pushCommentaryProgress(payload.progressText, { itemId: payload.itemId });
      return;
    }
    await draftPreview.pushToolProgress(
      buildChannelProgressDraftLineForEntry(discordConfig, {
        event: "item", itemId: payload.itemId, itemKind: payload.kind,
        title: payload.title, name: payload.name, phase: payload.phase,
        status: payload.status, summary: payload.summary,
        progressText: payload.progressText, meta: payload.meta,
      }),
    );
  },

  onPlanUpdate: async (payload) => {
    if (payload.phase !== "update") return;
    await draftPreview.pushToolProgress(buildChannelProgressDraftLine({
      event: "plan", phase: payload.phase, title: payload.title,
      explanation: payload.explanation, steps: payload.steps,
    }));
  },

  onApprovalEvent: async (payload) => {
    if (payload.phase !== "requested") return;
    await draftPreview.pushToolProgress(buildChannelProgressDraftLine({
      event: "approval", phase: payload.phase, title: payload.title,
      command: payload.command, reason: payload.reason, message: payload.message,
    }));
  },

  onCommandOutput: async (payload) => {
    if (payload.phase !== "end") return;
    await draftPreview.pushToolProgress(buildChannelProgressDraftLine({
      event: "command-output", phase: payload.phase, title: payload.title,
      name: payload.name, status: payload.status, exitCode: payload.exitCode,
    }));
  },

  onPatchSummary: async (payload) => {
    if (payload.phase !== "end") return;
    await draftPreview.pushToolProgress(buildChannelProgressDraftLine({
      event: "patch", phase: payload.phase, title: payload.title,
      name: payload.name, added: payload.added, modified: payload.modified,
      deleted: payload.deleted, summary: payload.summary,
    }));
  },

  onCompactionStart: async () => {
    // no draft preview update in Discord — just status reaction
  },

  onCompactionEnd: async () => {
    // no draft preview update in Discord — just status reaction
  },
}
```

#### Delivery Wiring

```ts
dispatcherOptions: {
  ...replyPipeline,
  humanDelay: resolveHumanDelayConfig(cfg, route.agentId),
  beforeDeliver: beforeDiscordPayloadDelivery,
  onReplyStart: onDiscordReplyStart,
  onFreshSettledDelivery: deliverPendingToolWarningFinalIfNeeded,
},
delivery: {
  deliver: deliverDiscordPayload,
  onError: onDiscordDeliveryError,
},
```

#### Cleanup (finally block)

```ts
finally {
  await draftPreview.cleanup();
  // Status reaction handling based on dispatch result
}
```

---

## 2. Current Cove State

### 2.1 `dispatch.ts` — Current Architecture

Cove currently has a **flat, single-layer** implementation:

**Draft stream:** Uses `createFinalizableDraftLifecycle` directly with a custom
`sendOrEdit` that serializes edits through an `editQueue` promise chain. No throttle
wrapper — the lifecycle handles throttling with `throttleMs: 250`.

**Progress tracking:** Uses `createToolProgressTracker` (a local module) which:
- Collects progress lines via SDK functions (`buildChannelProgressDraftLineForEntry`, etc.)
- Merges them into a running list
- Combines `assistantText + progressText` via `getCombinedText()`
- Calls `draft.update(combined)` on every progress update

**Partial text:** `onPartialReply` calls BOTH `toolProgress.onPartialReply(text)` (which
resets progress lines and sets assistantText) AND `draft.update(text)` directly.

**Final delivery:** The `deliver` function:
1. Sets `draftState.final = true`
2. Calls `draft.seal()`
3. If `draftMessageId` exists and not stopped → edit the draft message with final text
4. Else → `freshSend(text)` (chunked send via `sendDurableMessageBatch` + delete orphan draft)

**Missing compared to Discord:**
- No `createChannelProgressDraftCompositor` — Cove uses its own `createToolProgressTracker`
- No `deliverWithFinalizableLivePreviewAdapter` — no in-place preview finalization
- No preview stream mode support (`"progress"` | `"partial"` | `"block"`)
- No `resolvePreviewFinalText` logic for deciding if preview can be finalized
- No `beforeDeliver` filter
- No `dispatchChannelInboundReply` — uses `runInboundReplyTurn` with a manual dispatcher
- No transcript-backed final text resolution
- No reasoning progress / commentary progress
- No `onReasoningEnd` / `onAssistantMessageStart` boundary handling for the draft
- `disableBlockStreaming: true` hardcoded — no config-driven block streaming control
- `suppressDefaultToolProgressMessages: true` hardcoded
- `throttleMs: 250` — Discord uses 1200

### 2.2 `tool-progress.ts` — Current Progress System

The `createToolProgressTracker` is a local reimplementation that does MOST of what the
SDK compositor does, but in a different pattern:

**What it does match:**
- Uses SDK functions: `buildChannelProgressDraftLineForEntry`, `formatChannelProgressDraftLine`, etc.
- Uses `mergeChannelProgressDraftLine` for dedup/merge
- Uses `createChannelProgressDraftGate` for delayed start
- Handles all progress events: tool, item, plan, approval, command-output, patch, compaction

**What it does NOT match:**
- Not a compositor — doesn't call `createChannelProgressDraftCompositor`
- Mixes partial text + progress into `getCombinedText()` itself instead of letting compositor handle
- No `pushReasoningProgress` — compositor handles reasoning indicators
- No `pushCommentaryProgress` for preamble events
- No `deleteCurrent` capability
- No `suppress()` call when partial text arrives
- No `markFinalReplyStarted` / `markFinalReplyDelivered`
- No `shouldStartNow` / `isEmptyLine` customization hooks (uses gate directly)

### 2.3 `channel.ts` — Plugin Setup

Uses `createChatChannelPlugin` with outbound adapter. The gateway `startAccount`
creates the full dispatch pipeline. No structural issues here — the plugin shell
is fine; the dispatch internals need changing.

---

## 3. Exact Diff — What Cove Needs to Match Discord

### 3.1 Replace `createToolProgressTracker` with `createChannelProgressDraftCompositor`

**Discord uses:** `createChannelProgressDraftCompositor` from the SDK.

**Cove needs to:**
- Remove `tool-progress.ts` entirely
- Call `createChannelProgressDraftCompositor({...})` inside the new draft preview controller
- Wire `update` callback to `draftStream.update(previewText)`
- Wire `deleteCurrent` callback to `draftStream.deleteCurrentMessage()`
- Provide `isEmptyLine` and `shouldStartNow` functions (Cove equivalents of Discord's)

### 3.2 Add `createCoveDraftPreviewController` (New — Matches Layer 2)

Must match `createDiscordDraftPreviewController` structurally:

**Inputs (adapted for Cove):**
```ts
function createCoveDraftPreviewController(params: {
  cfg: any;
  channelConfig: StreamingCompatEntry | null | undefined;  // was discordConfig
  accountId: string;
  sourceRepliesAreToolOnly: boolean;
  textLimit: number;
  restClient: CoveRestClient;       // replaces deliveryRest
  deliverChannelId: string;
  replyReference: { peek: () => string | undefined };
  log: (msg: string) => void;
})
```

**Must implement:**
- Same stream mode resolution (`resolveChannelPreviewStreamMode(entry, "partial")`)
- Same conditional draftStream creation
- Same compositor wiring with `update`, `deleteCurrent`
- Same `updateFromPartial` logic (strip reasoning tags, dedup, mode dispatch)
- Same `handleAssistantMessageBoundary` logic
- Same `resolvePreviewFinalText` logic (adapted: no table conversion, no Discord chunking)
- Same `flush` and `cleanup` methods
- Same return shape
- Skip: `draftChunker` / block-mode chunking for now (see §6)

### 3.3 Add Finalization Adapter (Layer 3)

**Discord uses:** `defineFinalizableLivePreviewAdapter` + `deliverWithFinalizableLivePreviewAdapter`.

**Cove needs:**
```ts
const adapter = defineFinalizableLivePreviewAdapter({
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
    if (deliverablePayload.isError) return;
    // No mention rewriting needed for Cove
    return { content: previewFinalText };
  },

  editFinal: async (previewMessageId, edit) => {
    if (abortSignal?.aborted) throw new Error("process aborted");
    await restClient.editMessage(channelId, previewMessageId, edit.content);
  },

  onPreviewFinalized: () => {
    markUserFacingFinalDelivered();
    draftPreview.markPreviewFinalized();
  },

  // No TTS supplement for Cove
  buildSupplementalPayload: () => undefined,

  logPreviewEditFailure: (err) => {
    log?.warn?.(`cove: preview final edit failed; falling back to standard send (${err})`);
  },
});
```

### 3.4 Replace Flat Deliver with Layered Deliver

Current `dispatcherOptions.deliver` is a flat function. Replace with:

```ts
delivery: {
  deliver: deliverCovePayload,  // mirrors deliverDiscordPayload
  onError: onCoveDeliveryError,
},
dispatcherOptions: {
  ...replyPipeline,
  beforeDeliver: beforeCovePayloadDelivery,
  onReplyStart: onCoveReplyStart,
},
```

### 3.5 Wire Reply Options Identically to Discord

Replace the current `replyOptions` with Discord-identical callbacks:

| Callback | Current Cove | Target (Discord-identical) |
|---|---|---|
| `onPartialReply` | Calls both `toolProgress.onPartialReply` and `draft.update` | Only calls `draftPreview.updateFromPartial(payload.text)` — compositor handles the rest |
| `onToolStart` | Calls `toolProgress.onToolStart` | Calls `draftPreview.pushToolProgress(buildChannelProgressDraftLineForEntry(...))` |
| `onItemEvent` | Calls `toolProgress.onItemEvent` | Preamble → `pushCommentaryProgress`; else → `pushToolProgress(buildChannelProgressDraftLineForEntry(...))` |
| `onAssistantMessageStart` | Calls `toolProgress.onAssistantMessageStart` | Calls `draftPreview.handleAssistantMessageBoundary()` |
| `onReasoningEnd` | **Missing** | Calls `draftPreview.handleAssistantMessageBoundary()` |
| `onReasoningStream` | **Missing** | Calls `draftPreview.pushReasoningProgress(...)` |
| `disableBlockStreaming` | Hardcoded `true` | Config-driven via `draftPreview.disableBlockStreamingForDraft` |
| `suppressDefaultToolProgressMessages` | Hardcoded `true` | From `draftPreview.suppressDefaultToolProgressMessages` |
| `commentaryProgressEnabled` | **Missing** | From `draftPreview.commentaryProgressEnabled` (progress mode only) |

### 3.6 Use `dispatchChannelInboundReply` Instead of `runInboundReplyTurn`

Currently Cove uses `runInboundReplyTurn` from `openclaw/plugin-sdk/inbound-reply-dispatch`.
Discord uses `dispatchChannelInboundReply` from the reply runtime, called as:

```ts
const { dispatchReplyWithBufferedBlockDispatcher } = await loadReplyRuntime();

await dispatchChannelInboundReply({
  cfg, channel: "cove", accountId,
  agentId: route.agentId,
  routeSessionKey: persistedSessionKey,
  storePath: turn.storePath,
  ctxPayload,
  recordInboundSession,
  dispatchReplyWithBufferedBlockDispatcher,
  dispatcherOptions: { ...replyPipeline, beforeDeliver, onReplyStart, ... },
  delivery: { deliver: deliverCovePayload, onError: ... },
  record: turn.record,
  history: { ... },
  replyOptions: { ... },
});
```

**Note:** The current Cove code calls `channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher`
which is the same thing — just accessed differently. The wiring difference is in
`dispatcherOptions` and `delivery` objects. This may require moving to the
`dispatchChannelInboundReply` shape or confirming that `runInboundReplyTurn` passes
through `delivery` and `dispatcherOptions` the same way.

### 3.7 Throttle Rate

Change `throttleMs` from `250` to `1200` to match Discord default.

---

## 4. New Files

### `packages/plugin/src/draft-stream.ts`

Cove's Layer 1 — equivalent of `createDiscordDraftStream`.

```ts
export function createCoveDraftStream(params: {
  restClient: CoveRestClient;
  channelId: string;
  maxChars?: number;
  throttleMs?: number;           // default 1200
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
}
```

Implementation: same as Discord, substituting `restClient.sendMessage` /
`restClient.editMessage` / `restClient.deleteMessage` for Discord REST calls.
No `allowed_mentions`, no `flags`, no `message_reference` — Cove API doesn't need these.

### `packages/plugin/src/draft-preview.ts`

Cove's Layer 2 — equivalent of `createDiscordDraftPreviewController`.

```ts
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
}): CoveDraftPreviewController
```

Return type mirrors Discord's controller (§1.2 Return Shape).

### Files to Remove

- `packages/plugin/src/tool-progress.ts` — replaced by compositor inside `draft-preview.ts`

---

## 5. Migration Plan

Each step should leave tests passing and the plugin functional.

### Step 1: Add `draft-stream.ts`

Create `createCoveDraftStream` as a standalone module.
- Port `sendOrEditStreamMessage` from current `sendOrEdit` in `dispatch.ts`
- Wire through `createFinalizableDraftLifecycle` (already imported)
- Add `forceNewMessage` and `deleteCurrentMessage` methods
- Change throttle to 1200ms

**Test:** Unit test the stream in isolation — mock restClient, verify send/edit/delete
sequence, throttle behavior, dedup.

### Step 2: Add `draft-preview.ts`

Create `createCoveDraftPreviewController`.
- Import and use `createChannelProgressDraftCompositor` from SDK
- Implement `updateFromPartial`, `handleAssistantMessageBoundary`,
  `resolvePreviewFinalText`, `flush`, `cleanup`
- Wire compositor's `update` → `draftStream.update`
- Wire compositor's `deleteCurrent` → `draftStream.deleteCurrentMessage`
- Skip block-mode chunking (§6)

**Test:** Unit test the controller — mock draft stream, verify compositor integration,
partial text dedup, boundary resets.

### Step 3: Refactor `dispatch.ts` to Use New Layers

Replace the flat implementation:
1. Remove inline `sendOrEdit` → use `createCoveDraftStream`
2. Remove `createToolProgressTracker` usage → use `createCoveDraftPreviewController`
3. Restructure `replyOptions` to match Discord's callback pattern exactly
4. Add `onReasoningStream`, `onReasoningEnd` callbacks
5. Make `disableBlockStreaming` and `suppressDefaultToolProgressMessages` config-driven

**Test:** Integration test — full dispatch with mocked restClient, verify progress
rendering, partial text streaming, final delivery.

### Step 4: Add Finalization Adapter

Wire `defineFinalizableLivePreviewAdapter` + `deliverWithFinalizableLivePreviewAdapter`
into the delivery path:
1. Add `beforeCovePayloadDelivery` filter
2. Restructure delivery to use `delivery: { deliver, onError }` shape
3. Add `resolvePreviewFinalText` check in `buildFinalEdit`
4. Wire `onPreviewFinalized` → mark state

**Test:** Verify preview finalization — mock a draft with messageId, deliver final text
that fits, confirm edit-in-place instead of delete+resend.

### Step 5: Remove `tool-progress.ts`

Delete the file, remove imports, verify no remaining references.

### Step 6: Update Throttle & Config

- Confirm throttle at 1200ms
- Wire block streaming toggle from config
- Wire progress tool suppression from config

---

## 6. What to Skip (Discord-Specific)

### Skip for Now

| Feature | Discord Location | Why Skip |
|---|---|---|
| Block-mode chunking | `EmbeddedBlockChunker`, `resolveDiscordDraftStreamingChunking` | Block mode requires `EmbeddedBlockChunker` which is Discord-internal; Cove can support `"partial"` and `"progress"` modes first |
| `shouldSplitPreviewMessages` | `forceNewMessageIfNeeded` in block mode | Only used in block mode |
| Table conversion | `convertMarkdownTables` in `resolvePreviewFinalText` | Cove doesn't need table-to-text conversion |
| Discord mention rewriting | `rewriteDiscordKnownMentions`, `discordTextHasTargetedMention` in `buildFinalEdit` | Cove has no mention syntax |
| TTS supplement | `getReplyPayloadTtsSupplement`, `buildTtsSupplementMediaPayload` | No TTS in Cove |
| Embed suppression flags | `resolveDiscordMessageFlags`, `MessageFlags.SuppressEmbeds` | No embed system in Cove |
| `allowed_mentions` | `DISCORD_PREVIEW_ALLOWED_MENTIONS` | Cove doesn't have mention parsing |
| `message_reference` (reply threading) | Reply-to in `createChannelMessage` | Cove has reply references but they flow through the API differently |
| Status reactions | `createStatusReactionController`, ack reactions | Cove has its own reaction system already |
| PluralKit / bot loop protection | `recordChannelBotPairLoopAndCheckSuppression` | Not applicable to Cove |
| Sanitize payloads | `sanitizeDiscordFrontChannelReplyPayloads` | Discord-specific formatting |
| Pending tool warning final | `pendingToolWarningFinal` / `deliverPendingToolWarningFinalIfNeeded` | Edge case optimization; add later |
| `resolveCurrentTurnTranscriptFinalText` | Transcript-backed final text | Can add later for garbled-text resilience |
| Human delay | `resolveHumanDelayConfig` | Stylistic preference, not structural |

### Do Not Implement

| Feature | Reason |
|---|---|
| Guild history windows | Cove doesn't have guilds |
| Room event / delivery correlation | Cove doesn't have room events |
| Thread bindings | Cove threads work differently |
| Multiple REST clients (feedbackRest vs deliveryRest) | Cove uses a single restClient |

---

## 7. What to Keep Identical

These patterns MUST match Discord exactly — they are the structural core.

### 7.1 Three-Layer Architecture

```
Layer 1: createCoveDraftStream
  └─ sendOrEdit with throttle, dedup, createFinalizableDraftLifecycle
  └─ forceNewMessage, deleteCurrentMessage

Layer 2: createCoveDraftPreviewController
  └─ createChannelProgressDraftCompositor (SDK)
  └─ updateFromPartial, handleAssistantMessageBoundary
  └─ resolvePreviewFinalText, flush, cleanup

Layer 3: deliverCovePayload + defineFinalizableLivePreviewAdapter
  └─ deliverWithFinalizableLivePreviewAdapter (SDK)
  └─ buildFinalEdit → editFinal → onPreviewFinalized
  └─ fallback → deliverNormally → onNormalDelivered
```

### 7.2 SDK Function Usage

These SDK functions must be called identically:

| SDK Function | How Discord Uses It |
|---|---|
| `createFinalizableDraftLifecycle` | Layer 1 — wraps sendOrEdit |
| `createChannelProgressDraftCompositor` | Layer 2 — manages progress lines + draft updates |
| `defineFinalizableLivePreviewAdapter` | Layer 3 — defines edit/finalize contract |
| `deliverWithFinalizableLivePreviewAdapter` | Layer 3 — runs finalization-or-fallback |
| `resolveChannelPreviewStreamMode` | Layer 2 init — determines off/partial/progress/block |
| `resolveChannelStreamingBlockEnabled` | Layer 2 init — block streaming override |
| `resolveChannelStreamingPreviewToolProgress` | Layer 2 init — tool progress in preview |
| `resolveChannelStreamingSuppressDefaultToolProgressMessages` | Layer 2 init |
| `buildChannelProgressDraftLineForEntry` | Reply options — tool/item events |
| `buildChannelProgressDraftLine` | Reply options — plan/approval/command/patch events (note: no entry) |

### 7.3 State Transitions

The finalization state machine must match:

```
Stream idle
  → update(text) → streaming
  → pushToolProgress → progress rendering
  
Streaming
  → updateFromPartial → edit preview (throttled)
  → handleAssistantMessageBoundary → forceNewMessage (block) or reset (partial/progress)
  → deliver(final) → seal → check resolvePreviewFinalText
    → can finalize? → editFinal (in-place) → markPreviewFinalized
    → can't finalize? → deliverNormally (fresh send + delete preview)
  
Cleanup
  → progressDraft.cancel()
  → if not delivered: discardPending
  → if not delivered AND not finalized: clear (delete preview)
```

### 7.4 Callback Shape

The `replyOptions` object MUST expose the same callbacks with the same guard logic:

- `onPartialReply` only wired when draftStream exists AND NOT progress mode
- `onAssistantMessageStart` + `onReasoningEnd` both wired when draftStream exists
- `onToolStart` always uses `buildChannelProgressDraftLineForEntry(channelConfig, ...)`
- `onItemEvent` distinguishes preamble (→ commentary) from other events (→ tool progress)
- All plan/approval/command/patch events use `buildChannelProgressDraftLine` (no entry)
- `disableBlockStreaming` computed from config, not hardcoded
- `suppressDefaultToolProgressMessages` computed from config

### 7.5 Dedup / Guard Patterns

- `sendOrEdit` dedup: `trimmed === lastSentText → skip`
- `updateFromPartial` dedup: `cleaned === lastPartialText → skip`
- Partial-mode regression guard: `lastPartialText.startsWith(cleaned) → skip`
- Progress suppression on partial: `progressDraft.suppress()` when partial text arrives
- Abort guard: every delivery path checks `abortSignal`

---

## 8. SDK Import Paths (Verified)

All SDK functions are re-exported from `openclaw/plugin-sdk/channel-message`.
Verified against `node_modules/openclaw/dist/plugin-sdk/channel-message.d.ts`.

### Layer 1 — Draft Stream

```ts
import {
  createFinalizableDraftLifecycle,
  type FinalizableDraftStreamState,
  type DraftStreamLoop,
} from "openclaw/plugin-sdk/channel-message";
```

### Layer 2 — Preview Controller

```ts
import {
  // Compositor
  createChannelProgressDraftCompositor,
  type ChannelProgressDraftCompositor,

  // Stream mode resolution
  resolveChannelPreviewStreamMode,
  resolveChannelStreamingBlockEnabled,
  resolveChannelStreamingPreviewToolProgress,
  resolveChannelStreamingSuppressDefaultToolProgressMessages,
  type StreamingCompatEntry,

  // Progress line builders (used in replyOptions callbacks)
  buildChannelProgressDraftLineForEntry,
  buildChannelProgressDraftLine,
  type ChannelProgressDraftLine,
} from "openclaw/plugin-sdk/channel-message";
```

### Layer 3 — Finalization Adapter

```ts
import {
  defineFinalizableLivePreviewAdapter,
  deliverWithFinalizableLivePreviewAdapter,
  type FinalizableLivePreviewAdapter,
  type LivePreviewFinalizerResult,
  type LivePreviewFinalizerDraft,
} from "openclaw/plugin-sdk/channel-message";
```

### Text Processing (used by `updateFromPartial`)

```ts
import {
  stripReasoningTagsFromText,
  stripInlineDirectiveTagsForDelivery,
} from "openclaw/plugin-sdk/text-runtime";
```

### Typing & Message Send (already imported by Cove)

```ts
import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-message";
import { sendDurableMessageBatch } from "openclaw/plugin-sdk/channel-message";
```

---

## 9. Existing Test Files

Tests that will need updating during migration:

| File | What it covers |
|---|---|
| `src/dispatch-behavior.test.ts` | Full dispatch integration — progress, partial, final delivery |
| `src/dispatch-resilience.test.ts` | Error handling, abort, draft cleanup on failure |
| `src/edit-queue.test.ts` | Edit serialization (may become obsolete with Layer 1) |
| `src/rest-client.test.ts` | REST client mocks — will be reused by draft-stream tests |
| `src/message-queue.test.ts` | Message batching — unaffected |
| `src/resolver.test.ts` | Target resolution — unaffected |
| `src/coveMd-resolution.test.ts` | cove.md loading — unaffected |

### New tests to add

| File | Layer | What to test |
|---|---|---|
| `src/draft-stream.test.ts` | 1 | send/edit/delete sequence, throttle dedup, forceNewMessage, deleteCurrentMessage |
| `src/draft-preview.test.ts` | 2 | compositor integration, updateFromPartial dedup, boundary resets, resolvePreviewFinalText |

---

## 10. Debug Logging Audit

Current `dispatch.ts` has 12 `console.log` calls with `[cove-debug]` prefix from branch
`fix/draft-finalization-debug` (commit `dac1272`). These must be:

1. **Kept during migration** for parity debugging
2. **Moved** to the appropriate layer (e.g., `sendOrEdit` logs → `draft-stream.ts`)
3. **Removed** in a cleanup commit after migration is verified working

| Log call | Current location | Target location |
|---|---|---|
| `sendOrEdit called` | `dispatch.ts:55` | `draft-stream.ts` sendOrEdit |
| `sendOrEdit success` | `dispatch.ts:71` | `draft-stream.ts` sendOrEdit |
| `draft.update via toolProgress` | `dispatch.ts:48` | `draft-preview.ts` compositor `update` callback |
| `freshSend entry/complete` | `dispatch.ts:100,116` | `dispatch.ts` deliver fallback path |
| `deliver entry/post-seal/path` | `dispatch.ts:124,131,134,139` | `dispatch.ts` deliverCovePayload |
| `onPartialReply` | `dispatch.ts:147` | `dispatch.ts` replyOptions.onPartialReply |
