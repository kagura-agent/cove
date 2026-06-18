# Spec: #398 — Adopt SDK Outbound Adapter Framework (Discord Parity)

**Grade:** HEAVY  
**Author:** Kagura (spec review)  
**Date:** 2026-06-18  
**Status:** DRAFT for self-implementation (no delegation)

---

## 1. Must-Read Sources (Verified)

| # | Path | Lines | Purpose |
|---|------|-------|---------|
| 1 | `packages/plugin/src/channel.ts` | 393 | Plugin shell: gateway lifecycle, WS events, message queue |
| 2 | `packages/plugin/src/dispatch.ts` | 378 | Full dispatch pipeline: inbound → draft → stream → deliver |
| 3 | `packages/plugin/src/types.ts` | 54 | CoveAccount interface, gateway events |
| 4 | `packages/plugin/src/tool-progress.ts` | 223 | Tool progress tracker (formatting, gating, combined text) |
| 5 | `packages/plugin/src/cove-md-cache.ts` | 57 | TTL-based cove.md fetch cache |
| 6 | `packages/plugin/src/message-queue.ts` | 115 | Per-channel serial dispatch + batch merge |
| 7 | SDK: `core-DSxVv-v1.js:255` | - | `createChatChannelPlugin` factory |
| 8 | SDK: `direct-dm-mLeZeKii.js:9` | - | `dispatchInboundDirectDmWithRuntime` (deprecated path) |
| 9 | SDK: `channel-outbound-B3_Zy-kG.js:74` | - | `createChannelMessageAdapterFromOutbound` |
| 10 | SDK: `channel-outbound-B3_Zy-kG.js:857` | - | `sendDurableMessageBatch` |
| 11 | SDK: `draft-stream-controls-C8Kxicze.js:198` | - | `createFinalizableDraftLifecycle` |
| 12 | SDK: `channel-xSoWtQAt.js` | - | Discord plugin (reference implementation) |
| 13 | SDK: `provider-BB1GtroF.js:7122` | - | Discord `runChannelInboundEvent` usage |
| 14 | SDK: `reply-delivery-CRZ075t2.js:158` | - | Discord `deliverDiscordReply` → `sendDurableMessageBatch` |
| 15 | SDK: `inbound-reply-dispatch-BpzI7GIp.js:15` | - | `runChannelInboundEvent` (the correct inbound pipeline) |
| 16 | SDK: `plugin-sdk/types-BVAOMoZy.d.ts` | - | `ChannelTurnAdapter`, `AssembledChannelTurn`, `ChannelEventDeliveryAdapter` |
| 17 | Issue #398 | - | Full problem statement and target architecture |
| 18 | PR #399 branch: `origin/refactor/398-outbound-adapter` | 12 commits | Failed attempt — net +20 lines, editQueue race |

### Key SDK Deprecation Notices Found

From `inbound-reply-dispatch-BpzI7GIp.js`:
```
@deprecated Compatibility reply-dispatch bridge. New channel plugins should
expose a `message` adapter via `defineChannelMessageAdapter(...)` and route
sends through `deliverInboundReplyWithMessageSendContext(...)` or
`sendDurableMessageBatch(...)`.
```

From the same file, re: `dispatchInboundDirectDmWithRuntime`:
> This is a **deprecated helper** that wraps `resolveInboundRouteEnvelopeBuilderWithRuntime` + `runPreparedInboundReply`. New plugins should use `runChannelInboundEvent` with a proper `ChannelTurnAdapter`.

---

## 2. Current Main Behavior Contract

Each behavior listed below must be preserved exactly (testable assertion in parentheses).

### A. Draft Streaming Lifecycle

| # | Behavior | Evidence (dispatch.ts) | Test Assertion |
|---|----------|----------------------|----------------|
| A1 | First partial reply creates a new message via POST | L125-126: `restClient.sendMessage(channelId, trimmed)` → `draftMessageId = msg.id` | First REST call is POST to `/channels/{id}/messages`, returns message ID |
| A2 | Subsequent partials PATCH the draft | L123: `restClient.editMessage(channelId, draftMessageId, trimmed)` | After first POST, updates are PATCH to `/channels/{id}/messages/{draftId}` |
| A3 | Edits are sequential (editQueue) | L115: `editQueue = editQueue.then(...)` | No concurrent PATCHes; each waits for previous |
| A4 | Throttled at 250ms | L138: `throttleMs: 250` | Updates within 250ms window coalesced |
| A5 | Duplicate text suppressed | L119: `trimmed === lastSentText` check | Same text → no REST call |
| A6 | Draft stops on error | L130: `draftState.stopped = true` | After PATCH error, no more preview updates sent |
| A7 | Seal flushes pending update | L183: `await draft.seal()` | All pending throttled text flushed before finalization |

### B. Final Delivery

| # | Behavior | Evidence | Test Assertion |
|---|----------|----------|----------------|
| B1 | Final edit when draft active + not stopped | L187-190: `editMessage(channelId, draftMessageId, text)` | Final text PATCHed to draft message |
| B2 | Fallback on final edit failure | L192: falls to `cleanupAndSend` | If PATCH fails → delete draft + POST new message |
| B3 | Fresh send when no draft / draft stopped | L195: `cleanupAndSend(...)` | POST new message directly |
| B4 | Draft deleted on cleanup | L34-39: `deleteMessage(channelId, draftMessageId)` | Orphaned draft removed |
| B5 | Empty reply = no message | L178: `if (!text) return` | Zero-length text → no REST calls |

### C. Chunking (NOT on main — new behavior from SDK)

**NOTE:** Main does NOT have text chunking. There is no `COVE_TEXT_CHUNK_LIMIT` constant on main. The `cleanupAndSend` on main does a single `sendMessage` regardless of length. Issue #398 expects chunking to be handled by the SDK adapter automatically. This is **new behavior** that the SDK provides for free — NOT a behavior to preserve.

| # | Behavior | Main Status | Target |
|---|----------|-------------|--------|
| C1 | Messages >4000 chars split | NOT on main (single send) | SDK `sendDurableMessageBatch` handles via `textChunkLimit` |
| C2 | Streaming preview >4000 truncated | NOT on main | Cove-specific: truncate preview text + suffix |
| C3 | Chunk boundaries respect markdown | NOT on main | SDK `chunkTextForOutbound` with mode `markdown` |

### D. Context Injection

| # | Behavior | Evidence | Test Assertion |
|---|----------|----------|----------------|
| D1 | cove.md → GroupSystemPrompt | L339: `GroupSystemPrompt: "Channel rules from cove.md..."` | extraContext includes GroupSystemPrompt when cove.md exists |
| D2 | No cove.md → no injection | L338: conditional spread | extraContext omits GroupSystemPrompt when null |
| D3 | Thread uses parent's cove.md | L266-270: `if (channel.type === 11 && channel.parent_id)` | Thread reads parent channel's cove.md |
| D4 | Batched messages merged into body | L296-307: contextLines concatenation | bodyForAgent has `name: content\n` prefix for each earlier message |
| D5 | Image attachments as `[image: url]` | L311-313 | Attachment URLs appended to body text |

### E. Tool Progress

| # | Behavior | Evidence | Test Assertion |
|---|----------|----------|----------------|
| E1 | Progress lines rendered during tool use | tool-progress.ts L94-98: `renderProgress()` | Draft message includes formatted progress text |
| E2 | Progress + partial reply combined | L211: `parts.push(assistantText)` + `parts.push(progress)` | Combined text = assistantText + "\n\n" + progress |
| E3 | Progress cleared on new assistant message | L204: `onAssistantMessageStart` clears lines | Fresh turn = no stale progress |
| E4 | Compaction indicator | L95: `"📦 **Compacting context...**"` | During compaction, draft shows compaction message |
| E5 | Gate controls progress visibility | L100: `createChannelProgressDraftGate` | Progress only shown after first tool start |

### F. Lifecycle / Abort

| # | Behavior | Evidence | Test Assertion |
|---|----------|----------|----------------|
| F1 | Typing sent immediately | L78: `restClient.sendTyping(channelId).catch(() => {})` | First action is POST to typing endpoint |
| F2 | Typing kept alive (5s interval) | L82-84: `keepaliveIntervalMs: 5000` | Typing refreshed every 5s during dispatch |
| F3 | Typing cleaned on delivery | L178: `typingCallbacks.onCleanup?.()` | Typing stops when deliver begins |
| F4 | Abort on reconnect | channel.ts L259: loop over `pendingDispatches.values()` → `.abort()` | Hard reconnect aborts all channels |
| F5 | Aborted dispatch returns cleanly | L363-366: catch + check `abortController.signal.aborted` | No error thrown on abort |
| F6 | pendingDispatches track per-channel | L75: `pendingDispatches.set(channelId, abortController)` | One controller per channel |
| F7 | isCurrent() check throughout | L110: `pendingDispatches.get(channelId) === abortController` | Superseded dispatch stops all REST |
| F8 | Bot's own messages skipped | channel.ts L344: `if (message.author.id === gatewayClient.botUser.id) return` | No dispatch for self-authored messages |

### G. Batched Messages

| # | Behavior | Evidence | Test Assertion |
|---|----------|----------|----------------|
| G1 | Queue serializes per-channel | message-queue.ts L75: `this.processing.set(channelId, true)` | Only one dispatch at a time per channel |
| G2 | Multiple queued → batch dispatch | message-queue.ts L87-89 | batchDispatchFn called with all queued messages |
| G3 | Batch = earlier as context + last as primary | channel.ts L239-240 | `primary = messages[messages.length-1]`, `earlier = messages.slice(0, -1)` |
| G4 | Queue max = 5 | message-queue.ts L29: `MAX_QUEUE_SIZE = 5` | Oldest dropped on overflow |
| G5 | clearAll on reconnect | channel.ts L263: `messageQueue.clearAll()` | Queued messages discarded on hard reconnect |

---

## 3. Can the SDK Inbound Pipeline Cleanly Replace `dispatchInboundDirectDmWithRuntime`?

### 3.1 The Two Paths

| | `dispatchInboundDirectDmWithRuntime` (current) | `runChannelInboundEvent` (Discord's path) |
|---|---|---|
| **API style** | Flat params object with `deliver` callback | Adapter pattern (`ChannelTurnAdapter<TRaw>`) with `delivery: ChannelEventDeliveryAdapter` |
| **Routing** | Manual `runtime.channel.routing.resolveAgentRoute` patching | Adapter's `resolveTurn` returns `routeSessionKey` + `agentId` directly |
| **Delivery** | Plugin provides `deliver(payload)` and does everything | Plugin provides `delivery.deliver(payload, info)` — SDK handles lifecycle |
| **Session recording** | Handled internally by `dispatchInboundDirectDmWithRuntime` | Handled by turn kernel (same underlying `recordInboundSession`) |
| **Deprecation** | **Deprecated** — SDK comments say "use runChannelInboundEvent" | **Current recommended path** |
| **Streaming** | Must be wired manually via `replyOptions.onPartialReply` patch | Can use `dispatcherOptions` with typing callbacks, streaming via adapter |
| **Tool progress** | Manual wiring via `replyOptions.onToolStart/onItemEvent/...` patch | Same: passed via `dispatcherOptions.replyOptions` or `replyPipeline` |

### 3.2 What `runChannelInboundEvent` Needs (from Discord's example)

```typescript
await runChannelInboundEvent({
  channel: "cove",
  accountId,
  raw: message,                    // the raw WS message
  adapter: {
    ingest: (raw) => ({            // normalize raw event
      id: raw.id,
      rawText: raw.content,
      textForAgent: bodyForAgent,
      textForCommands: raw.content,
      raw
    }),
    resolveTurn: (input, eventClass, preflight) => ({
      // Return AssembledChannelTurn:
      cfg,
      channel: "cove",
      accountId,
      agentId: account.agentId,
      routeSessionKey: `agent:${account.agentId}:cove:group:${channelId}`,
      storePath,
      ctxPayload,                  // finalized context (same fields as today)
      recordInboundSession,
      dispatchReplyWithBufferedBlockDispatcher,
      delivery: {
        deliver: async (payload, info) => {
          await deliverCoveReply({ restClient, channelId, payload, ... });
        },
        onError: (err) => log?.error?.(...)
      },
      dispatcherOptions: {
        typingCallbacks,
        humanDelay: ...,
        replyOptions: { onPartialReply, onToolStart, ... }
      },
    }),
  }
});
```

### 3.3 The `deliver` Inside `ChannelEventDeliveryAdapter`

Discord's `delivery.deliver` calls `deliverDiscordReply` which calls `sendDurableMessageBatch`. The equivalent for Cove:

```typescript
async function deliverCoveReply(params) {
  const { restClient, channelId, payload, cfg, accountId } = params;
  const text = payload.text ?? "";
  if (!text) return;
  await sendDurableMessageBatch({
    cfg,
    channel: "cove",
    to: `channel:${channelId}`,
    accountId,
    payloads: [payload],
    deps: { sendText: (ctx) => restClient.sendMessage(ctx.to, ctx.text) },
    // ... formatting, identity, etc.
  });
}
```

### 3.4 Critical Gap: Streaming Preview

`sendDurableMessageBatch` handles **final delivery** only. The streaming draft lifecycle (`createFinalizableDraftLifecycle` + `sendOrEdit` + tool progress combined text) must still be wired through `dispatcherOptions.replyOptions.onPartialReply`.

**But here's the key insight:** Discord does NOT use `createFinalizableDraftLifecycle` directly either. Discord sends streaming previews through its own mechanism within the dispatcher options. Looking at Discord's provider (line ~7200), it has:

- `onReplyStart` → sends typing
- The turn kernel handles `onPartialReply` → Discord has its OWN streaming draft logic inside the delivery adapter's `durable` option

Actually examining more carefully: Discord does NOT do draft edit streaming in the same way Cove does. Discord sends individual messages (not edit-in-place previews). So Cove's edit-based streaming is a **Cove-specific feature** that needs to be preserved via the `dispatcherOptions.replyOptions` callbacks.

### 3.5 Answer: YES, with Caveats

**`runChannelInboundEvent` CAN replace `dispatchInboundDirectDmWithRuntime`** because:
1. It provides the same session recording + dispatch pipeline underneath
2. It accepts custom `delivery.deliver` for final sends
3. It accepts `dispatcherOptions.replyOptions` for streaming callbacks
4. It's the recommended non-deprecated path

**Caveats:**
1. Streaming draft (edit-in-place) is NOT handled by the SDK automatically — Cove must keep `createFinalizableDraftLifecycle` wired via `replyOptions.onPartialReply` in the `dispatcherOptions`
2. Tool progress integration stays in `replyOptions.onToolStart` etc. — same hooks
3. The abort/isCurrent pattern must be reimplemented outside the adapter (abort tracking wrapper)
4. `sendDurableMessageBatch` handles **chunking** of final delivery automatically — this IS the win

**What the SDK gives for free that we currently hand-write:**
- Final message chunking (split >4000 chars)
- Durable delivery with retry semantics
- Session recording lifecycle
- Envelope/context building (via `buildChannelInboundEventContext`)

**What we keep hand-writing (Cove-specific):**
- Draft edit streaming (createFinalizableDraftLifecycle + sendOrEdit)
- Tool progress tracking and combined text rendering
- cove.md injection
- Batched message context building
- Abort tracking per-channel

---

## 4. Rejected Alternatives

### Alternative A: "Full SDK adapter — delete dispatch.ts entirely"

**Approach:** Move ALL delivery logic (streaming + final) into `sendDurableMessageBatch`'s `preview` + `onPreviewUpdate` hooks. Delete `createFinalizableDraftLifecycle`, delete `tool-progress.ts` integration, let the SDK handle everything.

**Why rejected:**
1. `sendDurableMessageBatch`'s `preview` mechanism is designed for Discord's model (sequential messages, not edit-in-place). It does not directly support the edit-a-single-draft pattern.
2. Looking at the `DurableMessageSendContextParams.preview` type: it's `LiveMessageState<ReplyPayload>` — a payload-level concept, not a "constantly-edit-one-message" concept.
3. Tool progress combined text (`assistantText + "\n\n" + progressLines`) requires coordination between partial reply text and tool events — this is fundamentally per-tick state that the SDK has no awareness of.
4. **This is exactly what PR #399 tried and failed.** They imported `sendDurableMessageBatch` for the draft path, found it didn't fit, then deleted it and added manual patches, ending up +20 lines.

**Evidence of failure:** PR #399 commit `f324060` ("replace manual delivery with sendDurableMessageBatch") was immediately followed by `46273dd` ("use chunkTextForOutbound directly instead of sendDurableMessageBatch") — backtracking within 1 commit. Then `0042e13` ("remove SDK createFinalizableDraftLifecycle, fix tsc errors") — another direction reversal. The branch has 6 "fix" commits on top of 2 "refactor" commits, proving the approach was never stable.

### Alternative B: "Only switch outbound adapter shell, keep dispatchInboundDirectDmWithRuntime"

**Approach:** Wrap plugin in `createChatChannelPlugin` for the metadata/security/outbound/messaging shell, but keep `dispatchInboundDirectDmWithRuntime` for inbound exactly as-is. Only benefit: `sendText` outbound goes through the adapter for `message send` tool usage.

**Why rejected:**
1. `dispatchInboundDirectDmWithRuntime` is **explicitly deprecated**. SDK comments say "New channel plugins should expose a `message` adapter via `defineChannelMessageAdapter(...)` and route sends through `deliverInboundReplyWithMessageSendContext(...)` or `sendDurableMessageBatch(...)`."
2. This does NOT achieve the issue's stated goal: "dispatch.ts — entire file replaced by framework delivery". It leaves dispatch.ts completely untouched.
3. The `patchedRuntime` hack (L158-258 in dispatch.ts) that intercepts `routing.resolveAgentRoute` and `reply.dispatchReplyWithBufferedBlockDispatcher` is fragile — it relies on undocumented runtime internals. The 101-line monkey-patch reconstructs a fake `channelRuntime` with overridden routing + dispatcher options, which breaks if the SDK changes the shape of `DirectDmRuntime` (already happened: `dispatchReplyWithBufferedBlockDispatcher` is the current name but was previously `dispatchReply`).
4. No chunking benefit — final delivery still goes through manual `editMessage`/`sendMessage`.
5. Issue #398 explicitly calls this out: "Key issue: `dispatchInboundDirectDmWithRuntime` is a bypass path."
6. **This is basically what PR #399 ended up doing** — it switched the shell but kept the bypass.

### Alternative C: "Close issue #398 — the manual approach is fine"

**Approach:** Accept that Cove's dispatch logic is hand-written, well-tested, and working. Close #398. Future features (chunking, media) add incrementally.

**Why considered:**
- Main works correctly today.
- PR #399 proved the refactor is risky.
- The hand-written code is 378 lines, not thousands.
- SDK APIs are internal and may shift.

**Why rejected:**
1. Missing chunking (>4000 char replies silently fail on some clients or get truncated server-side).
2. The `patchedRuntime` hack is a ticking bomb — any SDK update that changes `dispatchReplyWithBufferedBlockDispatcher` signature breaks Cove silently.
3. Luna's directive is clear: this refactor should happen, just correctly.
4. Long-term: media support, rich messages, polls all need the adapter framework.

---

## 5. Recommended Approach: "Switch inbound to `runChannelInboundEvent` + delivery via `sendDurableMessageBatch` for final, keep draft streaming manual"

### Design Principle

Split dispatch.ts into two concerns:
1. **Inbound turn handling** → `runChannelInboundEvent` with a `ChannelTurnAdapter` (replaces `dispatchInboundDirectDmWithRuntime` + patchedRuntime hack)
2. **Delivery** → `sendDurableMessageBatch` for final text (handles chunking) + keep `createFinalizableDraftLifecycle` for streaming preview

This is exactly how Discord works:
- Discord's `resolveTurn` returns an `AssembledChannelTurn` with a `delivery` adapter
- Discord's `delivery.deliver` calls `sendDurableMessageBatch` for final sends
- Discord wires streaming through `dispatcherOptions`

### Structural Target

```
dispatch.ts (target: ~150 lines, down from 378)
├── createCoveInboundAdapter(): ChannelTurnAdapter<Message>
│   ├── ingest: normalize message → NormalizedTurnInput
│   └── resolveTurn: build AssembledChannelTurn
│       ├── ctxPayload via buildChannelInboundEventContext(...)
│       ├── delivery.deliver → deliverCoveReply (uses sendDurableMessageBatch)
│       └── dispatcherOptions.replyOptions → streaming hooks
├── deliverCoveReply(): final delivery via sendDurableMessageBatch
└── createCoveStreamingDraft(): draft lifecycle (kept from current code)
```

---

## 6. Phase Plan

### Phase 0: Behavioral Test Harness + Integration Baseline

**Goal:** Establish ground truth for all behaviors in Section 2 before touching any implementation.

**Acceptance criteria:**
- `dispatch-behavior.test.ts` covers behaviors A1-A7, B1-B5, D1-D5, E1-E5, F1-F8, G1-G5
- Tests pass against current main code
- Integration baseline: record a real Cove conversation showing streaming draft → final delivery (screenshot or log capture)
- Document: exact sequence of REST calls for a typical 3-message exchange
- **Snapshot baseline plugin total src/ line count** (record exact value, used as upper bound for Phase 3 hard constraint). **Baseline measured 2026-06-18: 1812 lines** (`packages/plugin/src/*.ts` excluding tests).

**Files changed:**
- `packages/plugin/src/dispatch-behavior.test.ts` — NEW (~300 lines)
- No implementation changes

**Commit boundary:** Single commit: `test(plugin): add behavioral contract tests for dispatch pipeline (#398)`

**Verification:**
- `pnpm vitest run dispatch-behavior` — all pass
- Manual: trigger real message on cove staging, capture REST call log
- `find packages/plugin/src -name '*.ts' ! -name '*.test.ts' | xargs wc -l | tail -1` recorded in spec for later comparison

### Phase 0.5: Pure Structural Extraction (No Behavior Change)

**Goal:** Extract the context-building section (cove.md fetch, attachment formatting, batched-message body construction — currently dispatch.ts L260-313, ~54 lines) into a dedicated `build-context.ts` helper. **Pure move + import; no logic edits.** This lets later phases reference a stable helper without conflating restructure with logic change.

**Why this phase exists:** The original spec deferred this move to Phase 3, which would mean introducing a new file at the same moment we switch the plugin shell. Doing the move now under a frozen behavior contract (Phase 0 tests just landed) catches regressions while the diff is trivially reviewable.

**Acceptance criteria:**
- `packages/plugin/src/build-context.ts` — NEW, contains `buildExtraContext`, `buildBodyForAgent`, and the cove.md + attachment helpers extracted verbatim from dispatch.ts
- `dispatch.ts` imports and calls the helper at the exact same call site (line-for-line equivalent)
- All Phase 0 behavioral tests still pass without any modification
- D1–D5 assertions in particular must pass byte-identical (re-run with `--reporter=verbose` and diff)
- dispatch.ts ~324 lines (down from 378); build-context.ts ~110 lines; **total src/ count +30 lines max** (allowing for JSDoc explaining extracted-function invariants; the 32 behavioral tests guarantee byte-identical behavior, which is the real contract — line count is a secondary smell test)

**Files changed:**
- `packages/plugin/src/build-context.ts` — NEW
- `packages/plugin/src/dispatch.ts` — extraction only (−54 lines, +2 import/call lines)

**Commit boundary:** Single commit: `refactor(plugin): extract context builders to build-context.ts (#398, no behavior change)`

**Verification:**
- `pnpm vitest run` — all tests pass
- `pnpm build` — succeeds
- Manual: run same Phase 0 baseline test (single short message) → REST call sequence byte-identical to baseline
- `git diff main --stat` shows only the two files above

### Phase 1: Introduce `runChannelInboundEvent` Adapter (Keep Delivery Manual)

**Goal:** Replace `dispatchInboundDirectDmWithRuntime` + `patchedRuntime` hack with `runChannelInboundEvent` + `ChannelTurnAdapter`. Keep existing delivery logic inside `delivery.deliver`.

**Acceptance criteria:**
- `dispatchInboundDirectDmWithRuntime` import removed
- `patchedRuntime` construction (L158-258) removed
- New `ChannelTurnAdapter` with `ingest` + `resolveTurn`
- `resolveTurn` returns `AssembledChannelTurn` with existing streaming/delivery logic inside `delivery.deliver`
- `buildChannelInboundEventContext` replaces manual `extraContext` construction
- dispatch.ts drops to ~300 lines (remove ~80 lines of runtime patching)
- All behavioral tests still pass

**Files changed:**
- `packages/plugin/src/dispatch.ts` — major rewrite (−80 lines)
- No other files

**Commit boundary:** Single commit: `refactor(plugin): switch inbound to runChannelInboundEvent adapter (#398)`

**Verification:**
- `pnpm vitest run dispatch-behavior` — all pass
- `pnpm build` — succeeds
- Manual: same REST call sequence as Phase 0 baseline

### Phase 2: Add Chunked-Fresh-Send Path via `sendDurableMessageBatch` (Split Strategy)

**Goal — disambiguated from original draft:** Do NOT replace the entire final-delivery path. Instead, use `sendDurableMessageBatch` ONLY where we currently send a fresh message (the `cleanupAndSend` path) — because that's where chunking benefit lives and where the SDK is safe to use. **Keep manual `editMessage` for the final-edit-to-existing-draft path** — because `sendDurableMessageBatch + previousReceipt` is unexercised by any official plugin (R2 / Open Q1) and we don't trust it.

**Decision rule (must be in code as a comment + asserted in test):**
```
if (draftMessageId && !draftState.stopped && text.length <= COVE_TEXT_CHUNK_LIMIT) {
  // Path 1: edit existing draft in-place (manual editMessage — preserves UX)
} else {
  // Path 2: cleanup draft + chunked fresh send (sendDurableMessageBatch — gets chunking)
}
```

**Acceptance criteria:**
- `cleanupAndSend` body replaced with a `sendDurableMessageBatch` call wired with:
  - `deps: { sendText: (ctx) => restClient.sendMessage(channelId, ctx.text) }`
  - `formatting: { textChunkLimit: 4000, chunkMode: "markdown" }`
  - **No `previousReceipt`** — Path 2 always sends fresh (matches today's `cleanupAndSend` semantics)
  - Draft cleanup (deleteMessage) still happens before the chunked send (send-before-delete order preserved per B2/B4)
- Path 1 (in-place final edit) untouched — `editMessage(channelId, draftMessageId, text)` exactly as today
- New chunking tests assert Path 2 splits >4000 char text into multiple messages
- New regression test: Path 1 still does a single PATCH for short final replies with active draft (no spurious POSTs)
- dispatch.ts drops to ~240 lines (Path 2 internals collapse; Path 1 stays explicit)
- All Phase 0 behavioral tests still pass

**Explicit non-goals for this phase:**
- Not switching final-edit semantics
- Not relying on `sendDurableMessageBatch.previousReceipt`
- Not changing streaming/draft lifecycle code (that's Phase 0.5 territory and stays frozen)

**Files changed:**
- `packages/plugin/src/dispatch.ts` — rewrite `cleanupAndSend` body only (~−30 lines, +10 lines for adapter wiring)
- `packages/plugin/src/dispatch-behavior.test.ts` — add chunking tests (+40 lines)

**Commit boundary:** Single commit: `refactor(plugin): chunked fresh-send path via sendDurableMessageBatch (#398)`

**Verification:**
- `pnpm vitest run dispatch-behavior` — all pass including new chunking tests
- `pnpm build` — succeeds
- Manual: send a >4000 char reply, verify it arrives as 2+ messages
- Manual: verify streaming preview still works (edit-in-place, Path 1 active)
- Manual: verify short replies still finalize via single PATCH (no extra POSTs)

### Phase 3: Switch Plugin Shell to `createChatChannelPlugin` + Final Cleanup

**Goal:** Wrap the plugin definition in `createChatChannelPlugin` for metadata/security/outbound consistency. This restructures channel.ts but does NOT introduce new files (build-context.ts already exists since Phase 0.5).

**Acceptance criteria:**
- `channel.ts` uses `createChatChannelPlugin({ base: { ... }, security: { ... }, outbound: { ... } })`
- `coveOutbound` adapter defined with `sendText`, `textChunkLimit: 4000`, `chunkerMode: "markdown"`
- Message adapter via `createChannelMessageAdapterFromOutbound(coveOutbound)` (used for outbound `message send` tool from CLI/cron)
- dispatch.ts final line count: ≤ 200 lines
- **Plugin total src/ count (excluding *.test.ts) must DROP by ≥150 lines vs Phase 0 baseline.** This is the hard issue-#398 deliverable — the issue promised "~200 lines of hand-written delivery logic deleted". Net code reduction is the contract.
- All Phase 0 behavioral tests pass
- Outbound test: a `message send` call goes through the new outbound adapter and produces a single REST POST (no chunking needed for short text)

**Files changed:**
- `packages/plugin/src/channel.ts` — restructure to `createChatChannelPlugin` (likely slight shrinkage as adapter handles meta/security boilerplate)
- `packages/plugin/src/dispatch.ts` — final dead code removal (−20 to −40 lines)
- `packages/plugin/src/types.ts` — add/verify `COVE_TEXT_CHUNK_LIMIT = 4000`

**Anti-pattern guard:** If channel.ts grows by more than the net reduction in dispatch.ts, the phase fails. The accounting rule is **total src/ lines, not per-file**. Re-run the wc command from Phase 0 and assert against the baseline minus 150.

**Commit boundary:** Single commit: `refactor(plugin): adopt createChatChannelPlugin shell (#398)`

**Verification:**
- `pnpm vitest run` — all tests pass
- `pnpm build` — succeeds
- `find packages/plugin/src -name '*.ts' ! -name '*.test.ts' | xargs wc -l | tail -1` ≤ (baseline − 150)
- Manual: full flow test on staging (message → streaming → final, both <4000 and >4000 char replies)
- Manual: test `openclaw message send --channel cove` (outbound path through new adapter)
- Manual: thread binding still works — reply in a bound thread, verify session continuity

---

## 7. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | **Tool progress breaks under new dispatch pipeline** — `dispatcherOptions.replyOptions` might not propagate all hook callbacks (onToolStart, onItemEvent, onPlanUpdate, etc.) through `runChannelInboundEvent` | Medium | High | Phase 1 test: verify tool progress renders during a real tool call. The `dispatcherOptions` in `AssembledChannelTurn` passes directly to `dispatchReplyWithBufferedBlockDispatcher` — same as Discord (provider-BB1GtroF.js:7200+). Key: include `suppressDefaultToolProgressMessages: true` and `disableBlockStreaming: true` in `replyOptions`. |
| R2 | **`sendDurableMessageBatch` final-edit-to-draft semantics unclear** — `previousReceipt` IS supported (verified: `send-DWoTcOuO.js:39` passes it to delivery context), BUT Discord's `deliverDiscordReply` does NOT use it — always sends fresh. So the "edit existing draft" path may work technically but is unexercised in production by any official plugin. | Medium | High | **Mitigation: Phase 2 keeps final edit as primary path (manual `editMessage`). Use `sendDurableMessageBatch` ONLY for the fallback/chunked path where we'd previously send a fresh message.** This means: if draft exists + not stopped + final text ≤ chunk limit → manual `editMessage`. Otherwise → `sendDurableMessageBatch` for chunked fresh delivery. This is the safe split that avoids relying on untested SDK behavior. |
| R3 | **Thread binding (#321) session key resolution** — current code patches `resolveAgentRoute` to override agentId. New adapter must resolve the same session key. | Low | High | In `resolveTurn`, directly compute `routeSessionKey` as `agent:${account.agentId}:cove:group:${channelId}`. No need for the `resolveAgentRoute` hack since we're building `AssembledChannelTurn` directly. Verify session continuity by testing a conversation across the refactor boundary (same session file used). |
| R4 | **editQueue race condition resurfaces** — the exact bug from PR #399. If `seal()` doesn't properly await the edit queue, the final edit can interleave with a streaming edit. | Medium | Critical | Keep the existing `editQueue` sequential promise pattern exactly as-is in Phase 1 and 2. The edit queue lives inside the streaming draft logic, which we're NOT changing until Phase 2. Phase 2 must NOT touch the streaming path — only the final delivery after seal completes. Add explicit test: fire `seal()` with a pending edit, verify final edit happens AFTER pending completes. |
| R5 | **`buildChannelInboundEventContext` produces different context shape** — if field names or nesting differ from current `extraContext` object, agent behavior changes | Low | Medium | Phase 1: log both old ctxPayload (from `dispatchInboundDirectDmWithRuntime`) and new ctxPayload (from `buildChannelInboundEventContext`) side-by-side in a test. Assert field-by-field equality for: GroupSystemPrompt, ChatType, SenderId, SenderName, ChannelId, MediaUrls, ReplyToId, ReplyToBody, ReplyToSender. |
| R6 | **Abort tracking not propagated to `runChannelInboundEvent`** — current `isCurrent()` check uses `pendingDispatches.get(channelId) === abortController`. The turn kernel may not have an equivalent abort signal. | Medium | Medium | `AssembledChannelTurn` does not have a built-in abort. Wrap the entire `runChannelInboundEvent` call in a try/catch that checks `abortController.signal.aborted`. For the streaming callbacks, keep the `isCurrent()` guard pattern — it's orthogonal to the turn kernel. The kernel will throw if the dispatch is cancelled externally (tested: Discord uses `ctx.abortSignal` at provider level). |
| R7 | **Cove-specific WS reconnect semantics clash with SDK lifecycle** — `createChatChannelPlugin` may impose its own reconnect/cleanup behavior that conflicts with `CoveGatewayClient` | Low | Medium | `createChatChannelPlugin` does NOT manage gateway lifecycle — it's just a metadata wrapper. The `gateway.startAccount` callback remains plugin-controlled. `CoveGatewayClient` connect/reconnect stays untouched. |
| R8 | **Test-only mocks can't catch streaming race conditions** — the editQueue race from PR #399 only manifests under real async timing | High | High | Phase 0 integration baseline is mandatory. Use real REST client against cove staging. Additionally: in unit tests, add artificial delays (`setTimeout`) in mock `editMessage` to simulate network latency and verify ordering. |

---

## 8. Real Integration Verification Plan

### Phase 0 Baseline Capture (MANDATORY before any refactor)

**Setup:**
1. cove staging server on VM1 (`:3501`) or localhost dev
2. Plugin built from `main`: `pnpm build && cp dist/index.js ~/.openclaw/extensions/cove/dist/`
3. Enable verbose logging: `log.info` calls in dispatch.ts already output REST call details

**Test Script:**
1. **Single short message** — send "hello" in cove-dev channel
   - Expected: typing → draft (POST) → final edit (PATCH) → done
   - Capture: REST call log showing POST then PATCH with final text

2. **Multi-turn with tool call** — send "what time is it?" (triggers time tool)
   - Expected: typing → draft showing progress → tool progress lines → final reply
   - Capture: sequence of PATCHes showing progress text → final PATCH with answer

3. **Rapid messages (batch test)** — send 3 messages within 500ms
   - Expected: queue batches, single dispatch with merged body
   - Capture: log showing "batching 3 messages for [channelId]"

4. **Reconnect abort** — disconnect gateway mid-reply (kill WS)
   - Expected: pending dispatch aborted, no orphaned draft
   - Capture: log showing "hard reconnect — aborting 1 pending dispatch(es)"

**Comparison Method:**
After each phase, re-run the same 4 tests. REST call sequence must match baseline (same endpoints called, same order). Visual: streaming UX must look identical (no extra messages, no duplicates, no missing previews).

### Race Condition Trigger

To reproduce the PR #399 editQueue race:
1. Configure agent to respond with a very long reply (>4000 chars)
2. While streaming, send another message in same channel
3. This triggers: messageQueue holds new message → current dispatch continues → seal → final edit → THEN next dispatch starts
4. The race: if seal's flush and the final edit are not properly sequenced, two PATCHes can land on the same message concurrently

**Automation:** Add a vitest test that:
- Mocks `editMessage` with a 50ms delay
- Fires `draft.update("text1")` then immediately `draft.seal()` then `deliver(finalText)`
- Asserts: editMessage calls are strictly sequential (no overlapping promises)

---

## 9. Hard Constraints Checklist

- [ ] dispatch.ts final line count ≤ 200 (currently 378)
- [ ] **Plugin total src/ line count (excluding *.test.ts) drops by ≥150 vs Phase 0 baseline of 1812 lines** → Phase 3 must produce ≤ 1662 lines (counted via `find packages/plugin/src -name '*.ts' ! -name '*.test.ts' | xargs wc -l | tail -1`)
- [ ] No commit simultaneously imports and deletes an SDK function
- [ ] Every phase ends with: `pnpm build` succeeds + `pnpm vitest run` passes + manual staging test
- [ ] `dispatchInboundDirectDmWithRuntime` fully removed by end of Phase 1
- [ ] `patchedRuntime` hack fully removed by end of Phase 1
- [ ] Streaming edit-in-place behavior preserved (not replaced by multi-message)
- [ ] Chunking works for >4000 char final replies (verified Phase 2)
- [ ] Tool progress still renders during tool execution (verified Phase 1)
- [ ] Phase 0.5 produces byte-identical REST call sequence vs Phase 0 baseline (proves pure structural extraction)
- [ ] Phase 2 does NOT use `sendDurableMessageBatch.previousReceipt` (R2 mitigation)
- [ ] Path 1 (in-place final edit) survives Phase 2 unchanged

---

## 10. Open Questions

1. **Can `sendDurableMessageBatch` with `previousReceipt` actually PATCH an existing message?** We verified it IS passed through (`send-DWoTcOuO.js:39`), but no official plugin exercises this path. The internal `send` callback in the delivery context runs `deliverOutboundPayloads` — need to trace whether it uses `previousReceipt` to do PATCH vs POST. **Recommendation: don't rely on this for Phase 2. Keep manual final-edit. Only use sendDurableMessageBatch for multi-chunk fresh sends.**

2. **Does `runChannelInboundEvent`'s turn kernel support passing `AbortSignal`?** Discord's provider wraps the whole call in a provider-level abort, but it's unclear if the kernel respects abort mid-dispatch or only checks at boundaries. **Mitigation: wrap `runChannelInboundEvent` in a try/catch that checks signal after await. The streaming callbacks already have `isCurrent()` guards independent of the kernel.**

3. **`buildChannelInboundEventContext` vs manual `extraContext` — exact field mapping.** The current code passes `extraContext: { ChatType, SenderId, SenderName, ChannelId, GroupSystemPrompt, ReplyToId, ... }`. Does `buildChannelInboundEventContext` produce the same fields? Need to verify field names match exactly (e.g., `sender: { name, id }` vs `SenderId`/`SenderName`). **Phase 1 must log both old and new payloads side-by-side to verify.**
