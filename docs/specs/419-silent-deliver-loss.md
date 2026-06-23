# Spec: #419 — Fix silent reply loss when `isCurrent()` returns false

## Problem

When the Cove plugin's `deliver` callback fires after an agent turn completes, `isCurrent()` can return `false`, silently discarding the final reply. The user sees only the intermediate tool-progress draft (e.g. a failed exec preview), never the actual response.

### Evidence (2026-06-23)

- Agent turn completed with tool calls + final text
- Draft message created showing tool progress → visible to user
- `deliver` callback invoked but **no `reply →` / `stream final →` / error logged**
- Second turn in queue processed normally afterward
- No reconnect, no dispatch timeout, no supersede, no `stream preview failed`

## Root Cause

`dispatchMessage` in `dispatch.ts` has three silent bail points in the deliver path:

```typescript
deliver: async (payload, _info) => {
  if (!isCurrent()) return;        // ← silent bail #1
  typingCallbacks.onCleanup?.();
  const text = payload.text ?? "";
  if (!text) return;               // ← silent bail #2 (empty text)
  if (!isCurrent()) return;        // ← silent bail #3
  // ... actual delivery
}
```

And two more in `freshSend` and `editFinal`:

```typescript
const freshSend = async (text: string) => {
  if (!isCurrent()) return;        // ← silent bail #4
  // ...
};

editFinal: async (id, text) => {
  if (!isCurrent()) return;        // ← silent bail #5
  // ...
}
```

When any of these bail, the final reply is lost with zero diagnostics.

## Fix

### 1. Add warn logs at each silent bail point

Every `isCurrent()` bail in the delivery path must log a warning:

```typescript
deliver: async (payload, _info) => {
  if (!isCurrent()) {
    log?.warn?.(`cove: deliver skipped — dispatch no longer current for [${channelId}]`);
    return;
  }
  // ...
  if (!isCurrent()) {
    log?.warn?.(`cove: deliver skipped (post-cleanup) — dispatch no longer current for [${channelId}]`);
    return;
  }
  // ...
}
```

Same for `freshSend` and `editFinal`.

### 2. Add warn log for empty text bail

```typescript
if (!text) {
  log?.warn?.(`cove: deliver skipped — empty text for [${channelId}]`);
  return;
}
```

### 3. Add warn log for `sendOrEdit` isCurrent bail

The streaming `sendOrEdit` function also silently returns false:

```typescript
const sendOrEdit = async (text: string): Promise<boolean> => {
  if (!isCurrent()) return false;
  // ...
};
```

This one is called frequently during streaming, so use a **once-per-dispatch** guard to avoid log spam:

```typescript
let warnedSendOrEditStale = false;
const sendOrEdit = async (text: string): Promise<boolean> => {
  if (!isCurrent()) {
    if (!warnedSendOrEditStale) {
      log?.warn?.(`cove: stream update skipped — dispatch no longer current for [${channelId}]`);
      warnedSendOrEditStale = true;
    }
    return false;
  }
  // ...
};
```

### 4. Cleanup orphaned draft on dispatch end

When a dispatch completes but no final reply was delivered (draft still exists), clean it up in the finally block so the user doesn't see stale tool progress:

```typescript
finally {
  if (pendingDispatches.get(channelId) === abortController) pendingDispatches.delete(channelId);
  // Clean up orphaned draft — if final delivery never happened,
  // delete the stale progress preview so the user doesn't see it frozen.
  if (draftMessageId && !draftState.final) {
    log?.warn?.(`cove: cleaning up orphaned draft ${draftMessageId} in [${channelId}]`);
    restClient.deleteMessage(channelId, draftMessageId).catch((e) =>
      log?.warn?.(`cove: failed to delete orphaned draft: ${e.message}`)
    );
  }
}
```

Note: this requires hoisting `draftMessageId` and `draftState` to an outer scope (or using a shared state object) so the finally block can access them.

## Scope

- **In scope**: diagnostic logging + orphaned draft cleanup
- **Out of scope**: investigating *why* `isCurrent()` returns false (requires separate repro); retry/fallback delivery on stale dispatch

## Files Changed

- `packages/plugin/src/dispatch.ts` — add warn logs + orphaned draft cleanup

## Testing

- Existing 102+ behavioral tests must pass (no behavior change for the happy path)
- New test: verify warn log is emitted when `isCurrent()` returns false during deliver
- New test: verify orphaned draft is deleted when dispatch completes without final delivery
