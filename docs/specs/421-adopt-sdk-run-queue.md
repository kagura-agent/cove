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

Discord does NOT do any queue management on reconnect — in-flight dispatches finish naturally, and the queue continues accepting new enqueues since `ctx.abortSignal` is still active.

Cove's reconnect handler simplifies to remove `pendingDispatches` and `messageQueue` cleanup:

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
  // No queue management needed — in-flight dispatches finish naturally,
  // new messages will be enqueued after reconnect.
  // Channel refresh logic remains unchanged.
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

Discord uses a `finalReplyDelivered` flag + `draftPreview.cleanup()` in its finally block:

```javascript
// Discord's pattern:
async cleanup() {
  if (!finalReplyDelivered) await draftStream?.discardPending();
  if (!finalReplyDelivered && !finalizedViaPreviewMessage && draftStream?.messageId())
    await draftStream.clear();  // delete orphaned draft
}
```

Cove should adopt the same pattern with a `finalReplyDelivered` flag (not `draftState.final`):

```typescript
// Add at top of dispatchMessage:
let finalReplyDelivered = false;

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

// Inner finally block:
finally {
  // No pendingDispatches to manage — lifecycle is SDK-managed
  // Orphaned draft cleanup (Discord parity)
  if (!finalReplyDelivered && draftMessageId) {
    log?.warn?.(`cove: cleaning up orphaned draft ${draftMessageId} in [${channelId}]`);
    await draft.discardPending();
    await restClient.deleteMessage(channelId, draftMessageId).catch((e: any) =>
      log?.warn?.(`cove: failed to delete orphaned draft: ${e.message}`)
    );
  }
}
```

This replaces the #419 approach of using `draftState.final` with Discord's `finalReplyDelivered` pattern, which is more explicit and doesn't depend on SDK internals.

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
    const last = entries.at(-1);
    if (!last) return;
    // Merge consecutive messages into one (same as Discord's syntheticMessage)
    const combinedContent = entries.map(e => e.message.content).filter(Boolean).join("\n");
    const mergedMessage = { ...last.message, content: combinedContent };
    runQueue.enqueue(mergedMessage.channel_id, async ({ lifecycleSignal }) => {
      const signals = [ctx.abortSignal, lifecycleSignal].filter(Boolean) as AbortSignal[];
      const abortSignal = signals.length > 0 ? AbortSignal.any(signals) : undefined;
      await dispatchMessage({ message: mergedMessage, account, restClient, channelRuntime, cfg, accountId: ctx.accountId, abortSignal, log });
    });
  },
});
```

This replaces both `batchDispatchFn` and `batchedMessages` with the SDK's debouncer pattern. The `batchedMessages` parameter in `dispatchMessage` and its downstream usage in `buildBodyForAgent` / `collectImageAttachmentUrls` should be removed.

Note: the debouncer implementation details (key format, merge strategy) may need adjustment during implementation to match Cove's message structure. The above is directionally correct.

## Known Behavioral Changes

| Behavior | Before | After | Impact |
|----------|--------|-------|--------|
| Queue overflow | Drop oldest at MAX_QUEUE_SIZE=5 | SDK queue is unbounded | Low — serial processing means queue rarely exceeds 1-2 items. Follow-up: add queue depth warning if needed. |
| Batch dispatch | Queue-level `batchDispatchFn` | Debouncer-level `createChannelInboundDebouncer` | Improved — matches Discord pattern, debounce before enqueue |
| Supersede detection | `isCurrent()` via pendingDispatches | `isAborted()` via lifecycleSignal | Improved — eliminates false-positive stale detection |
| editFinal on abort | Silent return | Throw error (SDK falls back) | Improved — SDK fallback triggers correctly |
| Reconnect cleanup | Manual abort + clear pendingDispatches | No queue action needed | Simpler — in-flight dispatches finish naturally |
| Status reporting | None | SDK reports `activeRuns`/`busy` via `setStatus` | New feature — free visibility |

## Files Changed

- `packages/plugin/src/channel.ts` — replace queue + pendingDispatches with `createChannelRunQueue`
- `packages/plugin/src/dispatch.ts` — replace `pendingDispatches`/`isCurrent()` with `lifecycleSignal`/`isAborted()`, remove `batchedMessages`
- `packages/plugin/src/build-context.ts` — remove `batchedMessages` parameter from helpers
- `packages/plugin/src/message-queue.ts` — **delete**
- `packages/plugin/src/message-queue.test.ts` — **delete**

## Testing

1. All existing dispatch-behavior tests must pass (adapt `pendingDispatches` mocks to `lifecycleSignal`)
2. Verify serial processing — second message waits for first to complete
3. Verify abort signal propagation — `lifecycleSignal.aborted` = true when plugin shuts down
4. Verify `editFinal` throws on abort → SDK falls back to `deliverNormally`
5. Verify reconnect deactivates + recreates run queue
6. Verify `isAborted()` returns false when `lifecycleSignal` is undefined (graceful degradation)
7. Tests must always provide `lifecycleSignal` in mocks

## Migration Risk

Medium. The SDK's `createChannelRunQueue` is battle-tested in the Discord plugin, and the core change (queue replacement) is straightforward. Two behavioral changes (unbounded queue, no batching) are user-visible but low-impact. The abort signal change is an improvement (merged signal matches Discord exactly).
