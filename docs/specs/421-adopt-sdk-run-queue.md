# Spec: #421 — Adopt SDK `createChannelRunQueue` for message dispatch

## Problem

The Cove plugin uses a hand-written `ChannelMessageQueue` + `pendingDispatches` Map + `isCurrent()` pattern for message dispatch. This diverges from the Discord plugin which uses the SDK's `createChannelRunQueue` (backed by `KeyedAsyncQueue`). The custom implementation has a unique failure mode where `isCurrent()` silently returns false and drops final replies (#419).

## Goal

Replace the custom queue + `pendingDispatches` with the SDK's `createChannelRunQueue`, aligning Cove with Discord's dispatch architecture. This eliminates the `isCurrent()` failure class entirely.

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
                      → isProcessAborted(lifecycleSignal) checks
                      → deliver/freshSend/editFinal check lifecycleSignal
                      → no pendingDispatches needed
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

Remove `pendingDispatches` parameter, add `lifecycleSignal`:

```typescript
// Before
export interface DispatchMessageOptions {
  ...
  pendingDispatches: Map<string, AbortController>;
}

// After
export interface DispatchMessageOptions {
  ...
  lifecycleSignal?: AbortSignal;
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

```typescript
// Before
gatewayClient.on("reconnect", () => {
  for (const c of pendingDispatches.values()) c.abort();
  pendingDispatches.clear();
  messageQueue.clearAll();
});
ctx.abortSignal.addEventListener("abort", () => {
  messageQueue.clearAll();
  for (const c of pendingDispatches.values()) c.abort();
  pendingDispatches.clear();
  gatewayClient.destroy();
});

// After
gatewayClient.on("reconnect", () => {
  // runQueue handles its own lifecycle via abortSignal
  // just need to deactivate and reconnect
  runQueue.deactivate();
  // Re-create runQueue for new connection? Or just let pending tasks finish
});
ctx.abortSignal.addEventListener("abort", () => {
  runQueue.deactivate();
  gatewayClient.destroy();
});
```

Note: `createChannelRunQueue` already listens to `abortSignal` internally and deactivates on abort. The explicit `deactivate()` on reconnect is for the reconnect-specific path.

### 7. Remove `pendingDispatches` cleanup in dispatch finally block

```typescript
// Before
finally {
  if (pendingDispatches.get(channelId) === abortController) pendingDispatches.delete(channelId);
}

// After — no pendingDispatches to clean up
// The lifecycleSignal is managed by the SDK's run queue
```

### 8. Delete `message-queue.ts`

The entire file is replaced by the SDK's `createChannelRunQueue`.

## Files Changed

- `packages/plugin/src/channel.ts` — replace queue + pendingDispatches with `createChannelRunQueue`
- `packages/plugin/src/dispatch.ts` — replace `pendingDispatches`/`isCurrent()` with `lifecycleSignal`/`isAborted()`
- `packages/plugin/src/message-queue.ts` — **delete** (replaced by SDK)
- `packages/plugin/src/message-queue.test.ts` — **delete** or rewrite as integration test

## Behavioral Differences

| Behavior | Before | After |
|----------|--------|-------|
| Queue overflow | Drop oldest at MAX_QUEUE_SIZE=5 | SDK's KeyedAsyncQueue (no built-in limit) |
| Batch dispatch | Supported (batchDispatchFn) | Not used — serial one-by-one (matches Discord) |
| Supersede detection | `isCurrent()` via pendingDispatches | `isAborted()` via lifecycleSignal |
| editFinal on abort | Silent return | Throw error (SDK falls back) |
| Reconnect cleanup | Manual abort + clear | `runQueue.deactivate()` |
| Status reporting | None | SDK reports `activeRuns`/`busy` via `setStatus` |

## Testing

1. All existing dispatch-behavior tests must pass (adapt `pendingDispatches` mocks to `lifecycleSignal`)
2. Verify serial processing — second message waits for first to complete
3. Verify abort signal propagation — `lifecycleSignal.aborted` = true when plugin shuts down
4. Verify `editFinal` throws on abort → SDK falls back to `deliverNormally`
5. Verify reconnect deactivates run queue
6. Verify message-queue.test.ts coverage is maintained (sequential processing, queue clearing)

## Migration Risk

Low. The SDK's `createChannelRunQueue` is battle-tested in the Discord plugin. The main risk is in test adaptation — existing mocks for `pendingDispatches` need to change to `lifecycleSignal`.
