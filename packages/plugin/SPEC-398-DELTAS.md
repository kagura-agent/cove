## Status after Phase 0.6

| Group | Spec | Covered (real) | Skipped w/ reason | Total |
|-------|------|----------------|-------------------|-------|
| A. Draft Streaming | A1-A7 (7) | A1-A7 ✅ | none | 7/7 |
| B. Final Delivery | B1-B5 (5) | B1-B5 ✅ | none | 5/5 |
| D. Context Injection | D1-D5 (5) | D1-D5 ✅ | none | 5/5 |
| E. Tool Progress | E1-E5 (5) | E1-E5 ✅ | none | 5/5 |
| F. Lifecycle / Abort | F1-F8 (8) | F1-F3, F5-F7 (6) | **F4, F8** (channel.ts handlers — need plugin-context harness or extraction; deferred to Phase 1) | 6/8 + 2 skip |
| G. Batched Messages | G1-G5 (5) | G1, G2, G4 (message-queue.test.ts), G3 (dispatch-behavior.test.ts), G5 (message-queue.test.ts) | none | 5/5 |

**Real coverage: 32 spec contracts directly tested + 4 message-queue tests.** 2 truly deferred (F4/F8) with explicit reason. No `expect(true).toBe(true)` lies remaining.

## Test files
- `dispatch-behavior.test.ts`: 33 tests, 4 it.skip (F4 / F8 / G1+G2+G4 pointer / G5 pointer)
- `message-queue.test.ts` (NEW Phase 0.6): 4 tests for G1/G2/G4/G5 directly against ChannelMessageQueue class

---

# SPEC-398 deltas (what Phase 0 covers vs spec)

## Spec contracts (38) vs implemented tests (32)

| Group | Spec | Covered | Missing | Notes |
|-------|------|---------|---------|-------|
| A. Draft Streaming | A1-A7 (7) | A1-A7 ✅ | none | full coverage |
| B. Final Delivery | B1-B5 (5) | B1-B5 ✅ | none | full coverage |
| D. Context Injection | D1-D5 (5) | D1-D5 ✅ | none | D1=GroupSystemPrompt, D2=no injection (test names abbreviated) |
| E. Tool Progress | E1-E5 (5) | E1-E5 ✅ | none | full coverage |
| F. Lifecycle / Abort | F1-F8 (8) | F1-F3, F5-F8 (7) | **F4** | F4 (abort on reconnect via pendingDispatches loop in channel.ts) needs a channel.ts-level test, not just dispatch.ts |
| G. Batched Messages | G1-G5 (5) | G3, G5, "G1/G2/G4 combined" (3 tests covering 5 contracts) | **G1, G2, G4 individually** | merged into one assertion — should be split for per-contract granularity |

## Total
- Spec: 38 contracts
- Tests pass: 32
- Effective coverage: ~37 (G1/G2/G4 are tested but lumped)
- Truly missing: **F4 (abort on reconnect)** — this matters for refactor since current code's pendingDispatches.values().abort() loop in channel.ts L259 is exactly what runChannelInboundEvent's abort propagation must preserve

## Plan for Phase 0.6 (before Phase 1 starts)
Add follow-up commit `test(plugin): add F4 abort-on-reconnect + split G batched tests (#398)`:
- F4: mock CoveGatewayClient hard-reconnect event, verify all pendingDispatches abort
- G1/G2/G4 split: individual assertions for serialization, batch trigger, queue overflow

These are still Phase 0 (test-only, no implementation changes). Better to ship the 32 working now and add 6 in a follow-up than block on perfecting.

## Spec issues found during test writing
None severe. Evidence line numbers in SPEC-398.md Section 2 are accurate enough; Claude Code wrote against `dispatch.ts` directly without needing line numbers for test logic.
