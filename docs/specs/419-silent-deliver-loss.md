# Spec: #419 — Fix silent reply loss when `isCurrent()` returns false

## Problem

When the Cove plugin's `deliver` callback fires after an agent turn completes, `isCurrent()` can return `false`, silently discarding the final reply. The user sees only the intermediate tool-progress draft (e.g. a failed exec preview), never the actual response.

### Evidence (2026-06-23)

- Agent turn completed with tool calls + final text
- Draft message created showing tool progress → visible to user
- `deliver` callback invoked but **no `reply →` / `stream final →` / error logged**
- Second turn in queue processed normally afterward
- No reconnect, no dispatch timeout, no supersede, no `stream preview failed`

### Repro Pattern

When the first tool call in a turn fails and gets rendered as a draft preview, the final reply is silently lost. Reproduced 2x on 2026-06-23.

## Root Cause

`dispatchMessage` in `dispatch.ts` has silent bail points in the delivery path — `isCurrent()` checks that return without logging. When any of these bail, the final reply is lost with zero diagnostics.

## Fix

### 1. Add warn logs at silent bail points in deliver

The `deliver` callback has two `isCurrent()` checks, but the code between them is entirely synchronous — the second check is unreachable. Remove the redundant check and add a warn log at the remaining one:

```typescript
deliver: async (payload, _info) => {
  if (!isCurrent()) {
    log?.warn?.(`cove: deliver skipped — dispatch no longer current for [${channelId}] (message: ${message.id})`);
    return;
  }
  typingCallbacks.onCleanup?.();
  const text = payload.text ?? "";
  if (!text) return;  // Legitimate for tool-only turns — no warn needed
  // ... actual delivery (removed redundant isCurrent check)
}
```

### 2. Add warn log in `freshSend` and wrap `sendText` failure

```typescript
const freshSend = async (text: string) => {
  if (!isCurrent()) {
    log?.warn?.(`cove: freshSend skipped — dispatch no longer current for [${channelId}] (message: ${message.id})`);
    return;
  }
  // ... delete draft ...
  log?.info?.(`cove: reply → [${channelId}] (${text.length} chars)`);
  try {
    await outboundBridge.sendText({ cfg, to: channelId, accountId, text });
  } catch (e: any) {
    log?.warn?.(`cove: freshSend failed for [${channelId}]: ${e.message}`);
    throw e;
  }
};
```

### 3. Add warn log in `editFinal`

`editFinal` must throw on stale dispatch (not silently return) so the SDK's `deliverFinalizableLivePreview` fallback triggers correctly:

```typescript
editFinal: async (id, text) => {
  if (!isCurrent()) {
    throw new Error(`cove: editFinal skipped — dispatch no longer current for [${channelId}]`);
  }
  // ...
}
```

### 4. Add once-per-dispatch warn for `sendOrEdit` stale bail

`sendOrEdit` is called frequently during streaming. Use a once-per-dispatch guard:

```typescript
let warnedSendOrEditStale = false;  // Never reset within a single dispatchMessage invocation
const sendOrEdit = async (text: string): Promise<boolean> => {
  if (!isCurrent()) {
    if (!warnedSendOrEditStale) {
      log?.warn?.(`cove: stream update skipped — dispatch no longer current for [${channelId}] (message: ${message.id})`);
      warnedSendOrEditStale = true;
    }
    return false;
  }
  // ...
};
```

### 5. Cleanup orphaned draft on dispatch end

When a dispatch completes but no final reply was delivered, delete the stale progress preview in the **inner** finally block (the one that already has `pendingDispatches.delete`). No hoisting needed — `draftMessageId` and `draftState` are already in scope.

```typescript
// Inner finally block
finally {
  if (pendingDispatches.get(channelId) === abortController) pendingDispatches.delete(channelId);
  // Clean up orphaned draft — if final delivery never happened,
  // delete the stale progress preview so the user doesn't see it frozen.
  // Note: draftState.final is set by the SDK's seal() BEFORE editFinal runs,
  // so this will NOT delete a successfully-edited final reply.
  // Cleanup runs regardless of isCurrent() — superseded dispatches must clean up their own drafts.
  if (draftMessageId && !draftState.final) {
    log?.warn?.(`cove: cleaning up orphaned draft ${draftMessageId} in [${channelId}] (message: ${message.id})`);
    await restClient.deleteMessage(channelId, draftMessageId).catch((e: any) =>
      log?.warn?.(`cove: failed to delete orphaned draft: ${e.message}`)
    );
  }
}
```

**SDK dependency note:** `draftState.final` is set to `true` by the SDK's `seal()` function (in `createFinalizableDraftLifecycle`), which is called by `deliverFinalizableLivePreview` **before** `editFinal`. This means:
- If `deliver` is called and reaches the adapter → `seal()` runs → `final = true` → cleanup skips ✅
- If `deliver` is never called (isCurrent bail) → `seal()` never runs → `final = false` → cleanup runs ✅
- If `deliver` is called but `editFinal` throws → `seal()` already ran → `final = true` → cleanup skips (SDK handles fallback) ✅

### Follow-up Investigation

This fix adds observability only — user replies will still be lost when `isCurrent()` returns false. The warn logs provide structured data (channelId, message.id, draftMessageId) to diagnose **why** `pendingDispatches` gets cleared/overwritten mid-dispatch in a sequential queue.

**Success criterion:** Next recurrence of silent reply loss is diagnosable from logs alone, without code changes or repro.

## Scope

- **In scope**: diagnostic logging + orphaned draft cleanup + editFinal stale-throw
- **Out of scope**: investigating *why* `isCurrent()` returns false (requires log data from this fix first)

## Files Changed

- `packages/plugin/src/dispatch.ts` — add warn logs, remove redundant isCurrent check, orphaned draft cleanup, editFinal throw-on-stale

## Testing

1. **Happy path — in-place final edit** → verify final message is NOT deleted by cleanup
2. **Happy path — freshSend (text > COVE_TEXT_CHUNK_LIMIT)** → verify draft deleted, fresh message sent, no double-delete in cleanup
3. **isCurrent() false at deliver entry** → warn logged AND orphaned draft deleted
4. **isCurrent() false during streaming sendOrEdit** → warn logged exactly once across N stream chunks
5. **editFinal with isCurrent() false** → throws error, SDK falls back to freshSend
6. **freshSend failure (sendText throws)** → warn logged with error message
