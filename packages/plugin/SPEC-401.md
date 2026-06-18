# SPEC-401: Adopt SDK Outbound Adapter Framework for Draft Streaming

## Status

Draft — Phase 0 (behavioral tests only, no implementation changes).

## Goal

Replace cove's hand-written draft streaming lifecycle (`sendOrEdit`, `editQueue`,
`draftState`, `createFinalizableDraftLifecycle` wiring, manual `deliver()`) with the
SDK's three-layer outbound adapter framework — the same architecture Discord uses.

This brings cove into parity with Discord's adapter shape, removes ~100 lines of
bespoke lifecycle code, and unlocks SDK-managed features (preview finalization,
supplemental payloads, live message receipts) for free.

---

## 1. Current Cove Behavior Contracts

These are the behaviors that **must be preserved** across the migration. Each has a
corresponding test in `dispatch-behavior.test.ts`.

### 1.1 Draft Streaming (Group A)

| ID | Contract | Mechanism |
|----|----------|-----------|
| A1 | First partial text creates a new message (POST) | `sendOrEdit` → `restClient.sendMessage` when `draftMessageId` is undefined |
| A2 | Subsequent partials edit the existing message (PATCH) | `sendOrEdit` → `restClient.editMessage` when `draftMessageId` is set |
| A3 | Edits are serialized (no concurrent API calls) | `editQueue` promise chain |
| A4 | Throttled at 250ms | `createFinalizableDraftLifecycle({ throttleMs: 250 })` |
| A5 | Duplicate text is suppressed | `lastSentText` comparison in `sendOrEdit` |
| A6 | Draft stops on API error (all further streaming updates dropped) | `draftState.stopped = true` on catch |
| A7 | `seal()` discards pending text, waits for in-flight | SDK lifecycle `.seal()` method |

### 1.2 Final Delivery (Group B)

| ID | Contract | Mechanism |
|----|----------|-----------|
| B1 | When a draft exists and is not error-stopped: final edit in place | `deliver()` → `restClient.editMessage(draftMessageId, finalText)` |
| B2 | When final edit fails: fallback to fresh send + delete orphan draft | `deliver()` catch → `freshSend(text)` |
| B3 | When no draft exists (or error-stopped): fresh send via `sendDurableMessageBatch` | `deliver()` else branch → `freshSend(text)` |
| B4 | Draft deletion is best-effort (warn, don't throw) | `deleteMessage` callback catches errors |
| B5 | Empty final text produces no message | `if (!text) return` guard in `deliver()` |

### 1.3 Tool Progress (Group E)

| ID | Contract | Mechanism |
|----|----------|-----------|
| E1 | `onProgressUpdate` calls `draft.update(combinedText)` | `createToolProgressTracker` wired to `draft.update` |
| E2 | `onPartialReply` clears progress lines + sets assistant text | `tracker.onPartialReply(text)` resets `lines=[]` |
| E3 | `onAssistantMessageStart` clears progress lines | `tracker.onAssistantMessageStart()` resets `lines=[]` |
| E4 | Compaction shows dedicated message, suppresses progress | `compacting` flag → `renderProgress()` returns compaction string |
| E5 | Progress gate delays display until a work tool fires | `gate.startNow()` on `onToolStart` for work tools |

### 1.4 Lifecycle / Abort (Group F)

| ID | Contract | Mechanism |
|----|----------|-----------|
| F1 | Typing sent immediately on dispatch start | `restClient.sendTyping(channelId)` in dispatch preamble |
| F2 | Typing keepalive at 5s intervals | `createTypingCallbacks({ keepaliveIntervalMs: 5000 })` |
| F3 | Typing cleaned up on final delivery | `typingCallbacks.onCleanup()` at top of `deliver()` |
| F5 | Aborted dispatch returns cleanly (no throw to caller) | `abortController.signal.aborted` check in catch |
| F6 | `pendingDispatches` entry cleaned up after dispatch completes | `finally` block deletes own entry if still current |
| F7 | `isCurrent()` prevents stale dispatch from editing | Guard at top of `sendOrEdit` + inside editQueue + in `deliver()` |

---

## 2. Discord Three-Layer Architecture

The SDK provides a composable three-layer stack for draft/preview message management:

### Layer 1: Draft Stream Loop (`createDraftStreamLoop`)

- **Import:** `openclaw/plugin-sdk/channel-lifecycle`
- **Role:** Raw throttled write pump. Accepts `update(text)` calls, coalesces them,
  flushes at most once per `throttleMs`.
- **API:** `{ update, flush, stop, resetPending, resetThrottleWindow, waitForInFlight }`
- **Cove today:** Used indirectly via Layer 2.

### Layer 2: Finalizable Draft Lifecycle (`createFinalizableDraftLifecycle`)

- **Import:** `openclaw/plugin-sdk/channel-lifecycle`
- **Role:** Wraps Layer 1 with lifecycle state (`stopped` / `final`). Adds `seal()`,
  `clear()`, `discardPending()`, `stopForClear()`.
- **API:** `{ update, stop, seal, discardPending, stopForClear, clear, loop }`
- **Cove today:** Used directly — this is the integration point in `dispatch.ts:80-94`.

### Layer 3: Live Preview Finalization (`deliverFinalizableLivePreview`)

- **Import:** `openclaw/plugin-sdk/channel-message`
- **Role:** Decision engine for draft-to-final transition. Handles:
  - Sealing the draft
  - Attempting edit-in-place of the draft with final content
  - Fallback to fresh send on edit failure
  - Supplemental payload delivery
  - Preview receipt creation
  - Error classification (`"fallback"` vs `"retain"`)
- **API:** Takes a `FinalizableLivePreviewAdapter` object + `deliverNormally` callback.
- **Cove today:** **Not used.** Cove reimplements this logic manually in `deliver()`.

### Supporting: Progress Compositor (`openclaw/plugin-sdk/channel-streaming`)

- **Role:** Content formatting for progress lines. Gate, line merging, text composition.
- **Cove today:** Used via `tool-progress.ts`. No changes needed — this layer is
  already SDK-aligned.

### Supporting: Convenience Wrapper (`deliverWithFinalizableLivePreviewAdapter`)

- **Import:** `openclaw/plugin-sdk/channel-message`
- **Role:** Unpacks a `FinalizableLivePreviewAdapter` object and delegates to
  `deliverFinalizableLivePreview`. Simplifies the call site.

---

## 3. SDK Function Availability (openclaw 2026.5.18)

All functions grep-confirmed in `node_modules/openclaw/dist/plugin-sdk/`:

| Function | Import Path | Confirmed |
|----------|-------------|-----------|
| `createDraftStreamLoop` | `openclaw/plugin-sdk/channel-lifecycle` | Yes |
| `createFinalizableDraftStreamControls` | `openclaw/plugin-sdk/channel-lifecycle` | Yes |
| `createFinalizableDraftStreamControlsForState` | `openclaw/plugin-sdk/channel-lifecycle` | Yes |
| `createFinalizableDraftLifecycle` | `openclaw/plugin-sdk/channel-lifecycle` | Yes |
| `takeMessageIdAfterStop` | `openclaw/plugin-sdk/channel-lifecycle` | Yes |
| `clearFinalizableDraftMessage` | `openclaw/plugin-sdk/channel-lifecycle` | Yes |
| `deliverFinalizableLivePreview` | `openclaw/plugin-sdk/channel-message` | Yes |
| `deliverWithFinalizableLivePreviewAdapter` | `openclaw/plugin-sdk/channel-message` | Yes |
| `defineFinalizableLivePreviewAdapter` | `openclaw/plugin-sdk/channel-message` | Yes |
| `createLiveMessageState` | `openclaw/plugin-sdk/channel-message` | Yes |
| `markLiveMessageFinalized` | `openclaw/plugin-sdk/channel-message` | Yes |
| `markLiveMessagePreviewUpdated` | `openclaw/plugin-sdk/channel-message` | Yes |
| `markLiveMessageCancelled` | `openclaw/plugin-sdk/channel-message` | Yes |
| `createPreviewMessageReceipt` | `openclaw/plugin-sdk/channel-message` | Yes |
| `sendDurableMessageBatch` | `openclaw/plugin-sdk/channel-message` | Yes |
| `createChannelProgressDraftGate` | `openclaw/plugin-sdk/channel-streaming` | Yes |
| `formatChannelProgressDraftLine` | `openclaw/plugin-sdk/channel-streaming` | Yes |
| `mergeChannelProgressDraftLine` | `openclaw/plugin-sdk/channel-streaming` | Yes |
| `formatChannelProgressDraftText` | `openclaw/plugin-sdk/channel-streaming` | Yes |

### Deprecated (available but should not be used for new code)

| Function | Replacement |
|----------|-------------|
| `deliverFinalizableDraftPreview` | `deliverFinalizableLivePreview` |
| `DraftPreviewFinalizerDraft` | `LivePreviewFinalizerDraft` |
| `DraftPreviewFinalizerResult` | `LivePreviewFinalizerResultKind` |

---

## 4. Architecture Mapping: Cove → SDK Adapter

### What changes

| Current (dispatch.ts) | Target (SDK adapter) |
|------------------------|---------------------|
| Hand-written `sendOrEdit` with `editQueue`, `lastSentText`, `draftState` | `createFinalizableDraftLifecycle` (already used — keep as-is for Layer 1+2) |
| Hand-written `deliver()` with manual seal → edit-or-freshSend logic | `deliverWithFinalizableLivePreviewAdapter` (Layer 3) |
| Inline `freshSend()` with `sendDurableMessageBatch` + orphan cleanup | Adapter's `deliverNormally` + `deliverSupplemental` callbacks |
| Manual `draftState.final = true` before `seal()` | Handled by `deliverFinalizableLivePreview` internally |
| Manual `draftMessageId` tracking | Adapter's `draft.id()` + `draft.seal()` + `draft.clear()` |

### What stays the same

| Component | Reason |
|-----------|--------|
| `createFinalizableDraftLifecycle` call (Layer 1+2) | Already SDK — just rewire the adapter to consume its output |
| `sendOrEdit` callback (provides Cove REST client bridge) | Still needed — Layer 1's `sendOrEditStreamMessage` parameter |
| `editQueue` (serialization) | Lives inside `sendOrEdit`, which is still the bridge callback |
| `createToolProgressTracker` + all event wiring | Already SDK-aligned, no changes needed |
| `createTypingCallbacks` | Orthogonal to draft lifecycle |
| `isCurrent()` / `guardFwd` staleness guards | Still needed for abort safety |
| `ChannelMessageQueue` (channel.ts) | Orthogonal — queue dispatches, not draft edits |

### New adapter shape

```typescript
// Pseudocode — the actual adapter object for cove
const adapter = defineFinalizableLivePreviewAdapter<
  { text: string },  // TPayload
  string,            // TId (message ID)
  string             // TEdit (text content)
>({
  draft: {
    flush: () => draft.loop.flush(),
    id: () => draftMessageId,
    seal: () => draft.seal(),
    discardPending: () => draft.discardPending(),
    clear: () => draft.clear(),
  },
  buildFinalEdit: (payload) => payload.text || undefined,
  editFinal: (id, text) => restClient.editMessage(channelId, id, text),
  handlePreviewEditError: () => "fallback",
  // No resolveFinalizedId — cove message IDs don't change on edit
  // No createPreviewReceipt — cove doesn't track receipts yet
  // No onPreviewFinalized — no post-finalization hooks needed
  // No buildSupplementalPayload — no supplemental messages
});
```

Then in `deliver()`:

```typescript
deliver: async (payload, info) => {
  if (!isCurrent()) return;
  typingCallbacks.onCleanup?.();
  if (!payload.text) return;
  await deliverWithFinalizableLivePreviewAdapter({
    kind: info.kind as "final",
    payload,
    adapter,
    deliverNormally: (p) => freshSend(p.text),
  });
}
```

---

## 5. Phase Breakdown

### Phase 0: Behavioral Tests (this PR)

- Add behavioral tests to `dispatch-behavior.test.ts` that lock down the
  draft streaming lifecycle contract from Section 1
- Tests must pass against current implementation (no code changes)
- Coverage targets:
  - Draft lifecycle transitions: create → throttle → edit → seal → final
  - Tool progress composition with draft text
  - Compaction-period draft behavior
  - Final delivery branching: edit-in-place vs fresh send vs fallback
  - Abort mid-draft

### Phase 1: Wire Layer 3 Adapter

- Replace hand-written `deliver()` with `deliverWithFinalizableLivePreviewAdapter`
- Define `FinalizableLivePreviewAdapter` for cove
- Wire `draft` object to satisfy `LivePreviewFinalizerDraft` interface
- Keep `sendOrEdit`, `editQueue`, `createFinalizableDraftLifecycle` unchanged
- All Phase 0 tests must still pass

### Phase 2: Simplify sendOrEdit

- Evaluate whether `lastSentText` dedup can be removed (the SDK loop's
  `pendingText` coalescing may be sufficient)
- Evaluate whether `editQueue` can be simplified or removed (the SDK loop
  already serializes via `inFlightPromise`)
- Only proceed if tests confirm no behavioral regression

### Phase 3: Adopt LiveMessageState tracking

- Add `createLiveMessageState` to track preview lifecycle phase
- Wire `markLiveMessagePreviewUpdated` on successful draft edits
- Wire `markLiveMessageFinalized` on successful finalization
- Enable preview receipts if cove adds message tracking

---

## 6. Risks and Known Issues

### 6.1 editQueue Race (PR #399)

**Problem:** PR #399 discovered that without the `editQueue` promise chain,
concurrent `sendOrEdit` calls could race — two `sendMessage` calls could fire
before either returned, creating two draft messages. The second one becomes an
orphan.

**Mitigation:** Phase 1 does NOT remove `editQueue`. The adapter change only
replaces `deliver()` — the `sendOrEdit` callback (which owns `editQueue`) stays
identical. Phase 2 explicitly requires test validation before simplifying.

### 6.2 sendDurableMessageBatch Silent Failure (PR #404)

**Problem:** PR #404 found that `sendDurableMessageBatch` can silently swallow
errors when the `deps.cove` callback throws with certain error shapes. The SDK
catches the error but doesn't propagate it, making the final delivery appear
successful when the user never received the message.

**Mitigation:**
- Phase 1 preserves the existing `freshSend()` function as `deliverNormally` —
  the same `sendDurableMessageBatch` call path is used
- The adapter's `handlePreviewEditError` returns `"fallback"` — on any
  edit-in-place failure, the adapter falls through to `deliverNormally`, which
  exercises the same `sendDurableMessageBatch` path
- No new failure modes are introduced

### 6.3 `draftState.final` Timing

**Problem:** The current code sets `draftState.final = true` before calling
`draft.seal()`. The SDK's `deliverFinalizableLivePreview` manages `final` state
internally. If both paths try to set `final`, the behavior is idempotent (both
set it to `true`), but the intent should be clear.

**Mitigation:** Phase 1 should remove the manual `draftState.final = true` and
let the adapter handle it via `seal()`.

### 6.4 isCurrent() Guard in deliver()

**Problem:** The current `deliver()` checks `isCurrent()` twice — once before
seal, once after. The SDK adapter doesn't know about cove's `pendingDispatches`
abort mechanism.

**Mitigation:** The `isCurrent()` checks stay outside the adapter call. The
adapter receives control only when the dispatch is confirmed current. If the
dispatch is superseded during `seal()`, the second `isCurrent()` check in the
current code prevents the final edit — this guard must be preserved by wrapping
the adapter call.

### 6.5 Deprecated API Names

**Problem:** The SDK has deprecated `deliverFinalizableDraftPreview` in favor of
`deliverFinalizableLivePreview`. Using the deprecated name would work but produce
warnings in future SDK versions.

**Mitigation:** Use the new names (`LivePreviewFinalizer*`, `deliverFinalizableLivePreview`)
from the start.

---

## 7. Out of Scope

- `channel.ts` changes (reconnect handler, message queue) — untouched
- `tool-progress.ts` changes — already SDK-aligned
- Block-level streaming (`disableBlockStreaming: true` stays)
- `cove.md` context injection — orthogonal
- Message queue batching — orthogonal
