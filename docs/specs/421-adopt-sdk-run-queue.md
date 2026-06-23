# Spec: #421 — Adopt SDK `createChannelRunQueue` for message dispatch

## Problem

The Cove plugin uses a hand-written `ChannelMessageQueue` + `pendingDispatches` Map + `isCurrent()` pattern for message dispatch. This diverges from the Discord plugin which uses the SDK's `createChannelRunQueue` (backed by `KeyedAsyncQueue`). The custom implementation has a unique failure mode where `isCurrent()` silently returns false and drops final replies (#419).

## Goal

Replace the custom queue + `pendingDispatches` with the SDK's `createChannelRunQueue`, aligning Cove with Discord's dispatch architecture. This eliminates the `isCurrent()` failure class entirely.

## Relationship to #419

This PR **subsumes** the orphaned draft cleanup from #419 by implementing it with Discord's `finalReplyDelivered` pattern (Change 7) instead of #419's `draftState.final` approach. After this PR:
- #419's diagnostic logging (warn on stale bail) is still valuable and can land separately
- #419's orphaned draft cleanup is handled here with a better pattern
- The `isCurrent()` failure class is eliminated entirely

## Current Architecture

```
messageCreate → ChannelMessageQueue.enqueue()
                  → processNext() (recursive, serial per channel)
                    → dispatchMessage()
                      → pendingDispatches.set(channelId, abortController)
                      → isCurrent() = pendingDispatches.get(channelId) === abortController
                      → deliver/freshSend/editFinal all check isCurrent()
                      → finally: pendingDispatches.delete(channelId)
```

## Target Architecture

```
messageCreate → runQueue.enqueue(channelId, task)
                  → KeyedAsyncQueue (serial per key, SDK-managed)
                    → dispatchMessage({ lifecycleSignal })
                      → isAborted() = lifecycleSignal?.aborted
                      → deliver/freshSend/editFinal check isAborted()
                      → finally: orphaned draft cleanup only
```

## Changes

### 1. Replace `ChannelMessageQueue` with `createChannelRunQueue` in `channel.ts`

```typescript
// Before
import { ChannelMessageQueue } from "./message-queue.js";
const pendingDispatches = new Map<string, AbortController>();
const messageQueue = new ChannelMessageQueue({ ... });

// After
import { createChannelRunQueue } from "openclaw/plugin-sdk/channel-lifecycle";
const runQueue = createChannelRunQueue({
  setStatus: (status) => ctx.setStatus({ accountId: ctx.accountId, ...status }),
  abortSignal: ctx.abortSignal,
  onError: (error) => log?.error?.(`cove: message run failed: ${error}`),
});

// Queue depth guard — SDK queue is unbounded, add safety limits
const QUEUE_WARN_THRESHOLD = 10;
const QUEUE_DROP_THRESHOLD = 20;
const queueDepth = new Map<string, number>();

function trackEnqueue(channelId: string): boolean {
  const depth = (queueDepth.get(channelId) ?? 0) + 1;
  queueDepth.set(channelId, depth);
  if (depth > QUEUE_DROP_THRESHOLD) {
    log?.warn?.(`cove: queue overflow for [${channelId}] (depth: ${depth}), dropping message`);
    queueDepth.set(channelId, depth - 1);
    return false; // reject enqueue
  }
  if (depth > QUEUE_WARN_THRESHOLD) {
    log?.warn?.(`cove: queue depth high for [${channelId}] (depth: ${depth})`);
  }
  return true; // allow enqueue
}

function trackDequeue(channelId: string): void {
  const depth = queueDepth.get(channelId) ?? 0;
  if (depth > 0) queueDepth.set(channelId, depth - 1);
}
// Usage: check trackEnqueue(channelId) before runQueue.enqueue,
// call trackDequeue(channelId) at end of dispatch task.
```

### 2. Update `messageCreate` handler

Discord merges `runtime.abortSignal` (account-level) with `lifecycleSignal` (queue-level) so that both plugin shutdown AND queue deactivation abort the dispatch. Cove should do the same using `mergeAbortSignals` — a utility copied from the OpenClaw SDK internals.

`mergeAbortSignals` is NOT the same as `AbortSignal.any()`:
- Filters out `undefined`/`null` signals (AbortSignal.any throws on undefined)
- Returns `undefined` when no valid signals (AbortSignal.any([]) returns a never-abort signal)
- Short-circuits for single signal (no wrapping overhead)

Copy the function into a local util file:

```typescript
// utils.ts
export function mergeAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => Boolean(s));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(active);
  const controller = new AbortController();
  for (const signal of active) if (signal.aborted) { controller.abort(); return controller.signal; }
  const onAbort = () => { controller.abort(); for (const s of active) s.removeEventListener("abort", onAbort); };
  for (const signal of active) signal.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}
```

Then use it in messageCreate:

```typescript
// Before
messageQueue.enqueue(message);

// After
import { mergeAbortSignals } from "./utils.js";

runQueue.enqueue(message.channel_id, async ({ lifecycleSignal }) => {
  const abortSignal = mergeAbortSignals([ctx.abortSignal, lifecycleSignal]);
  await dispatchMessage({
    message, account, restClient, channelRuntime, cfg,
    accountId: ctx.accountId, abortSignal, log,
  });
});
```

### 3. Update `dispatchMessage` signature in `dispatch.ts`

Remove `pendingDispatches` parameter, add `abortSignal` (merged signal from Change 2). Also remove `batchedMessages` (see Change 9).

```typescript
// Before
export interface DispatchMessageOptions {
  message: Message; batchedMessages?: Message[];
  ...
  pendingDispatches: Map<string, AbortController>;
}

// After
export interface DispatchMessageOptions {
  message: Message;
  ...
  abortSignal?: AbortSignal;
}
```

### 3b. Update catch block in dispatch.ts

The existing catch block references `abortController.signal.aborted` — update to use `abortSignal`:

```typescript
// Before
catch (err: any) {
  if (abortController.signal.aborted) {
    log?.info?.(`cove: dispatch aborted in [${channelId}]`);
  } else { throw err; }
}

// After
catch (err: any) {
  if (abortSignal?.aborted) {
    log?.info?.(`cove: dispatch aborted in [${channelId}]`);
  } else { throw err; }
}
```

### 4. Replace `isCurrent()` with `isAborted()` in `dispatch.ts`

```typescript
// Before
const abortController = new AbortController();
pendingDispatches.set(channelId, abortController);
const isCurrent = () => pendingDispatches.get(channelId) === abortController;

// After (matches Discord's isProcessAborted pattern)
const isAborted = () => Boolean(abortSignal?.aborted);
```

All `isCurrent()` checks become `isAborted()` checks. The semantic is inverted (isCurrent=true means proceed → isAborted=false means proceed), so:
- `if (!isCurrent()) return;` → `if (isAborted()) return;`

### 5. Update `editFinal` to throw on abort (Discord parity)

```typescript
// Before (silent return)
editFinal: async (id, text) => {
  if (!isCurrent()) return;
  ...
}

// After (throw, matching Discord behavior)
editFinal: async (id, text) => {
  if (isAborted()) throw new Error("cove: dispatch aborted");
  ...
}
```

### 6. Update reconnect/abort handlers in `channel.ts`

Discord has NO reconnect handler at all in its message handler. It does not register a reconnect listener — queue lifecycle is entirely managed by `abortSignal`. When the account-level abort fires, the SDK deactivates the run queue; there is no separate reconnect path.

Cove still needs a reconnect handler because our gateway client emits reconnect events and we perform channel refresh on reconnect. However, queue/dispatch management should be removed from the reconnect handler — those concerns are now handled by the SDK's abort signal lifecycle.

```typescript
// Before
gatewayClient.on("reconnect", () => {
  for (const c of pendingDispatches.values()) c.abort();
  pendingDispatches.clear();
  messageQueue.clearAll();
});

// After
gatewayClient.on("reconnect", () => {
  log?.info?.(`cove: hard reconnect`);
  // Queue/dispatch management removed — lifecycle is SDK-managed via abortSignal.
  // In-flight dispatches finish naturally, new messages enqueue after reconnect.
  // Channel refresh logic (below) remains unchanged.
});
```

For plugin shutdown, `ctx.abortSignal` deactivates the run queue automatically (SDK listens internally):

```typescript
ctx.abortSignal.addEventListener("abort", () => {
  // runQueue auto-deactivates via its abortSignal listener
  gatewayClient.destroy();
});
```

### 7. Simplify dispatch finally block + add orphaned draft cleanup (Discord parity)

Discord uses a `finalReplyDelivered` flag + `finalizedViaPreviewMessage` flag + `draftPreview.cleanup()` in its finally block:

```javascript
// Discord's pattern:
async cleanup() {
  if (!finalReplyDelivered) await draftStream?.discardPending();
  if (!finalReplyDelivered && !finalizedViaPreviewMessage && draftStream?.messageId())
    await draftStream.clear();  // delete orphaned draft
}
```

The `finalizedViaPreviewMessage` guard prevents deleting a draft that was already finalized in-place via `editFinal`. Without this guard, a dispatch that completes via in-place edit (no separate final reply) would incorrectly have its message deleted by the cleanup block.

Cove should adopt the same pattern with both flags:

```typescript
// Add at top of dispatchMessage:
let finalReplyDelivered = false;
let finalizedViaPreviewMessage = false;

// Set after successful delivery in deliver callback:
deliver: async (payload, _info) => {
  // ... delivery logic ...
  finalReplyDelivered = true;
}

// And in freshSend after successful sendText:
const freshSend = async (text: string) => {
  // ...
  await outboundBridge.sendText(...);
  finalReplyDelivered = true;
};

// Set after successful editFinal (in-place finalization):
editFinal: async (id, text) => {
  if (isAborted()) throw new Error("cove: dispatch aborted");
  // ... edit logic ...
  finalizedViaPreviewMessage = true;
}

// Inner finally block:
finally {
  // No pendingDispatches to manage — lifecycle is SDK-managed
  // Orphaned draft cleanup (Discord parity)
  if (!finalReplyDelivered && !finalizedViaPreviewMessage && draftMessageId) {
    log?.warn?.(`cove: cleaning up orphaned draft ${draftMessageId} in [${channelId}]`);
    await draft.discardPending();
    await restClient.deleteMessage(channelId, draftMessageId).catch((e: any) =>
      log?.warn?.(`cove: failed to delete orphaned draft: ${e.message}`)
    );
  }
}
```

This replaces the #419 approach of using `draftState.final` with Discord's `finalReplyDelivered` + `finalizedViaPreviewMessage` pattern, which is more explicit and doesn't depend on SDK internals.

### 8. Delete `message-queue.ts` and `message-queue.test.ts`

The custom queue is fully replaced by the SDK's `createChannelRunQueue`. Delete both files.

Sequential processing and queue clearing behavior is covered by the SDK's existing tests. Cove-specific integration tests (Change 10) verify the end-to-end behavior.

### 9. Replace queue-level batching with debouncer (Discord parity)

Discord does NOT batch at the queue level — but it DOES batch at the **debouncer** level using `createChannelInboundDebouncer` (from `openclaw/plugin-sdk/channel-inbound`). Rapid consecutive messages from the same user in the same channel are debounced and merged into a single synthetic message before being enqueued.

Cove should adopt the same pattern:

```typescript
// Before: batching in ChannelMessageQueue via batchDispatchFn

// After: debouncing before enqueue (Discord pattern)
import { createChannelInboundDebouncer, shouldDebounceTextInbound } from "openclaw/plugin-sdk/channel-inbound";

const { debouncer } = createChannelInboundDebouncer({
  cfg,
  channel: "cove",
  buildKey: (entry) => `cove:${ctx.accountId}:${entry.message.channel_id}:${entry.message.author.id}`,
  shouldDebounce: (entry) => shouldDebounceTextInbound({
    text: entry.message.content,
    cfg,
    hasMedia: (entry.message.attachments?.length ?? 0) > 0,
  }),
  onFlush: async (entries) => {
    if (abortSignal?.aborted) return; // abort check before flush (Discord parity)
    const last = entries.at(-1);
    if (!last) return;
    // Merge consecutive messages into one (same as Discord's syntheticMessage)
    const combinedContent = entries.map(e => e.message.content).filter(Boolean).join("\n");
    const mergedMessage = { ...last.message, content: combinedContent };
    runQueue.enqueue(mergedMessage.channel_id, async ({ lifecycleSignal }) => {
      const abortSignal = mergeAbortSignals([ctx.abortSignal, lifecycleSignal]);
      await dispatchMessage({ message: mergedMessage, account, restClient, channelRuntime, cfg, accountId: ctx.accountId, abortSignal, log });
    });
  },
});
```

This replaces both `batchDispatchFn` and `batchedMessages` with the SDK's debouncer pattern. The `batchedMessages` parameter in `dispatchMessage` and its downstream usage in `buildBodyForAgent` / `collectImageAttachmentUrls` should be removed.

Note: the debouncer implementation details (key format, merge strategy) may need adjustment during implementation to match Cove's message structure. The above is directionally correct.

**Media/attachment safety:** Messages with attachments are never debounced — `shouldDebounceTextInbound` returns `false` when `hasMedia: true`. This means the synthetic merged message (which sets `attachments: []`) can never lose attachment data. A media message arriving mid-buffer triggers an immediate flush of buffered text-only messages, then processes itself as a standalone dispatch. This is confirmed by Discord plugin source — two-layer defense: (1) `shouldDebounce` rejects media entries, (2) synthetic message forces `attachments: []` as a safety net.

#### Additional Discord debouncer patterns

The following patterns are present in Discord's debouncer integration. Each is noted with its applicability to Cove:

**1. Abort check before flush:** The `onFlush` callback checks `abortSignal?.aborted` at the start and skips processing entirely if aborted. This prevents queuing work after shutdown. (Reflected in the code snippet above.)

**2. Preflight filtering:** Discord runs `preflightDiscordMessage` before queueing to filter out messages that shouldn't be processed (e.g., bot self-loop, missing permissions, unsupported channel types). Currently Cove does some of this filtering inside `dispatchMessage` — for efficiency, filtering should happen before enqueue so rejected messages never enter the debouncer or queue. Implement a `preflightCoveMessage` check in `channel.ts` that runs before `debouncer.push()`.

**3. Batch message ID tracking (required):** When multiple messages are debounced into one, Discord tracks all original message IDs on the context payload: `MessageSids` (array of all IDs), `MessageSidFirst` (first message ID), and `MessageSidLast` (last message ID). Cove must do the same so the agent knows which user messages were batched. Add these fields to the dispatch context or message metadata passed to `dispatchMessage`:

```typescript
// In onFlush, when entries.length > 1:
const messageSids = entries.map(e => e.message.id);
const mergedMessage = {
  ...last.message,
  content: combinedContent,
  batchMeta: { MessageSids: messageSids, MessageSidFirst: messageSids[0], MessageSidLast: messageSids.at(-1) },
};
```

**4. Reply batch gate:** Discord uses `applyImplicitReplyBatchGate` to adjust reply threading behavior for batched messages (e.g., choosing which message to reply to in a thread context). Note this as a pattern to be aware of — may not apply to Cove's current threading model, but should be revisited if Cove adds threaded reply support.

**5. Replay guard / deduplication:** Discord uses `createClaimableDedupe` as a replay guard to prevent processing duplicate messages that may arrive via gateway replays. This is optional for Cove — only needed if the Cove gateway can replay messages. If gateway replays are possible, implement a similar deduplication check keyed on message ID before `debouncer.push()`.

## Known Behavioral Changes

| Behavior | Before | After | Impact |
|----------|--------|-------|--------|
| Queue overflow | Drop oldest at MAX_QUEUE_SIZE=5 | SDK queue is unbounded + depth guard | Low — serial processing means queue rarely exceeds 1-2 items. Depth guard: warn at 10, drop oldest at 20 (see Change 1). |
| Batch dispatch | Queue-level `batchDispatchFn` | Debouncer-level `createChannelInboundDebouncer` | Improved — matches Discord pattern, debounce before enqueue |
| Supersede detection | `isCurrent()` via pendingDispatches | `isAborted()` via lifecycleSignal | Improved — eliminates false-positive stale detection |
| editFinal on abort | Silent return | Throw error (SDK falls back) | Improved — SDK fallback triggers correctly |
| Reconnect cleanup | Manual abort + clear pendingDispatches | No queue action needed | Simpler — in-flight dispatches finish naturally |
| Status reporting | None | SDK reports `activeRuns`/`busy` via `setStatus` | New feature — free visibility |

## Files Changed

- `packages/plugin/src/channel.ts` — replace queue + pendingDispatches with `createChannelRunQueue` + debouncer
- `packages/plugin/src/dispatch.ts` — replace `pendingDispatches`/`isCurrent()` with `abortSignal`/`isAborted()`, add `finalReplyDelivered` + `finalizedViaPreviewMessage`, remove `batchedMessages`
- `packages/plugin/src/utils.ts` — **new** — `mergeAbortSignals` utility
- `packages/plugin/src/build-context.ts` — remove `batchedMessages` parameter from helpers
- `packages/plugin/src/message-queue.ts` — **delete**
- `packages/plugin/src/message-queue.test.ts` — **delete**

## Testing

1. All existing dispatch-behavior tests must pass (adapt `pendingDispatches` mocks to `abortSignal`)
2. Verify serial processing — second message waits for first to complete
3. Verify abort signal propagation — merged `abortSignal` aborts when either source signal fires
4. Verify `editFinal` throws on abort → SDK falls back to `deliverNormally`
5. Verify reconnect does NOT touch queue/dispatch — in-flight dispatches finish naturally
6. Verify `isAborted()` returns false when `abortSignal` is undefined (graceful degradation)
7. Verify orphaned draft cleanup: `!finalReplyDelivered && !finalizedViaPreviewMessage && draftMessageId` → draft deleted
8. Verify in-place finalized draft is NOT deleted: `finalizedViaPreviewMessage = true` → cleanup skips
9. Verify debouncer merges rapid consecutive messages into single dispatch
10. Tests must always provide `abortSignal` in mocks

## Out of Scope

- **WS lifecycle adapter** — Issue #421 title mentions "gateway adapter pattern" but this spec only covers the run queue + dispatch alignment. WS connect/reconnect/heartbeat lifecycle refactoring is a separate effort.
- **Cove-specific preflight logic** — The spec notes Discord's preflight pattern but detailed implementation of `preflightCoveMessage` is left to the implementer based on existing filtering in `dispatchMessage`.

## Migration Risk

Medium. The SDK's `createChannelRunQueue` is battle-tested in the Discord plugin, and the core change (queue replacement) is straightforward. Two behavioral changes (queue depth guard replaces hard limit, debouncer replaces queue-level batching) are user-visible but low-impact. The abort signal change is an improvement (merged signal matches Discord exactly).
