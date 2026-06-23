# Spec: #421 — Adopt SDK `createChannelRunQueue` for message dispatch

## Problem

The Cove plugin uses a hand-written `ChannelMessageQueue` + `pendingDispatches` Map + `isCurrent()` pattern for message dispatch. This diverges from the Discord plugin which uses the SDK's `createChannelRunQueue` (backed by `KeyedAsyncQueue`). The custom implementation has a unique failure mode where `isCurrent()` silently returns false and drops final replies (#419).

## Goal

Replace the custom queue + `pendingDispatches` with the SDK's `createChannelRunQueue`, aligning Cove with Discord's dispatch architecture. This eliminates the `isCurrent()` failure class entirely.

## Relationship to #419

PR #422 (#419) proposes orphaned draft cleanup in dispatch.ts's inner finally block. This spec removes `pendingDispatches` from that same finally block but **preserves** the orphaned draft cleanup logic from #419. Specifically:
- **Delete**: `if (pendingDispatches.get(channelId) === abortController) pendingDispatches.delete(channelId);`
- **Keep**: orphaned draft cleanup (`if (draftMessageId && !draftState.final) { ... delete draft ... }`)
- The draft cleanup's `isAborted()` check is intentionally omitted — superseded/aborted dispatches must still clean up their own drafts.

If #419 lands first, this PR preserves its cleanup. If this PR lands first, #419 adds cleanup to the simplified finally block.

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

```typescript
// Before
messageQueue.enqueue(message);

// After
runQueue.enqueue(message.channel_id, async ({ lifecycleSignal }) => {
  await dispatchMessage({
    message, account, restClient, channelRuntime, cfg,
    accountId: ctx.accountId, lifecycleSignal, log,
  });
});
```

### 3. Update `dispatchMessage` signature in `dispatch.ts`

Remove `pendingDispatches` parameter, add `lifecycleSignal`. Also remove `batchedMessages` (see Change 9).

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
  lifecycleSignal?: AbortSignal;
}
```

### 3b. Update catch block in dispatch.ts

The existing catch block references `abortController.signal.aborted` — update to use `lifecycleSignal`:

```typescript
// Before
catch (err: any) {
  if (abortController.signal.aborted) {
    log?.info?.(`cove: dispatch aborted in [${channelId}]`);
  } else { throw err; }
}

// After
catch (err: any) {
  if (lifecycleSignal?.aborted) {
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

// After
const isAborted = () => Boolean(lifecycleSignal?.aborted);
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

On reconnect, deactivate the current run queue and create a new one. This matches the current hard-abort behavior (abort all in-flight + clear queue).

```typescript
// Before
gatewayClient.on("reconnect", () => {
  for (const c of pendingDispatches.values()) c.abort();
  pendingDispatches.clear();
  messageQueue.clearAll();
});

// After
let runQueue = createRunQueue(); // extract creation to a helper
gatewayClient.on("reconnect", () => {
  log?.info?.(`cove: hard reconnect — deactivating run queue`);
  runQueue.deactivate();
  runQueue = createRunQueue(); // fresh queue for new connection
});
```

For plugin shutdown, `ctx.abortSignal` already deactivates the run queue (SDK listens internally):

```typescript
ctx.abortSignal.addEventListener("abort", () => {
  // runQueue auto-deactivates via its abortSignal listener
  gatewayClient.destroy();
});
```

### 7. Simplify dispatch finally block

```typescript
// Before
finally {
  if (pendingDispatches.get(channelId) === abortController) pendingDispatches.delete(channelId);
}

// After — only orphaned draft cleanup remains (from #419, if landed)
// No pendingDispatches to manage — lifecycle is SDK-managed
```

### 8. Delete `message-queue.ts` and `message-queue.test.ts`

The custom queue is fully replaced by the SDK's `createChannelRunQueue`. Delete both files.

Sequential processing and queue clearing behavior is covered by the SDK's existing tests. Cove-specific integration tests (Change 10) verify the end-to-end behavior.

### 9. Remove `batchedMessages` parameter

The batch dispatch feature (`batchDispatchFn`) is removed. Messages are processed serially one-by-one, matching Discord behavior. The `batchedMessages` parameter in `dispatchMessage` and its downstream usage in `buildBodyForAgent` / `collectImageAttachmentUrls` should be removed.

**Rationale:** The batch feature was added to combine rapid consecutive messages into one dispatch, but:
- Discord doesn't batch — it processes serially
- The SDK's `KeyedAsyncQueue` is serial by design
- Batching adds complexity for a marginal benefit
- Agent context already includes recent messages via session history

## Known Behavioral Changes

| Behavior | Before | After | Impact |
|----------|--------|-------|--------|
| Queue overflow | Drop oldest at MAX_QUEUE_SIZE=5 | SDK queue is unbounded | Low — serial processing means queue rarely exceeds 1-2 items. Follow-up: add queue depth warning if needed. |
| Batch dispatch | Multiple queued messages batched into one dispatch | Serial one-by-one | Low — matches Discord behavior, agent gets context via session history |
| Supersede detection | `isCurrent()` via pendingDispatches | `isAborted()` via lifecycleSignal | Improved — eliminates false-positive stale detection |
| editFinal on abort | Silent return | Throw error (SDK falls back) | Improved — SDK fallback triggers correctly |
| Reconnect cleanup | Manual abort + clear pendingDispatches | deactivate + recreate runQueue | Same effective behavior |
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

Medium. The SDK's `createChannelRunQueue` is battle-tested in the Discord plugin, and the core change (queue replacement) is straightforward. However, three behavioral changes (unbounded queue, no batching, different abort semantics) are user-visible. All are low-impact individually but warrant careful testing.
