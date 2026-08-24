import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { CoveUsageCollector, type UsageBridge } from "./usage-collector.js";

const TEST_STATE = "/tmp/cove-usage-test-baselines.json";

function bridge(overrides: Partial<UsageBridge> = {}): UsageBridge {
  return {
    runForSession: () => null,
    parentSessionFor: () => null,
    restForSession: () => null,
    // Default: no session is claimed fresh by this Cove run (pre-existing
    // sessions behave like the historical collector).
    consumeFreshSession: () => false,
    ...overrides,
  };
}

function newCollector(record: ReturnType<typeof vi.fn>, overrides: Partial<UsageBridge> = {}, warn = vi.fn()) {
  return new CoveUsageCollector(bridge({
    runForSession: () => "cove-run-1",
    restForSession: () => ({ recordRunUsage: record }) as any,
    ...overrides,
  }), { warn }, TEST_STATE);
}

function usageMsg(input: number, output: number, cacheRead = 0, cost?: number, model = "deepseek-v4-flash") {
  return {
    role: "assistant" as const,
    provider: "floway-sg",
    model,
    usage: {
      input, output, cacheRead, cacheWrite: 0,
      ...(cost !== undefined ? { cost: { total: cost } } : {}),
    },
  };
}

describe("CoveUsageCollector (agent_end source)", () => {
  beforeEach(() => rmSync(TEST_STATE, { force: true }));
  afterEach(() => rmSync(TEST_STATE, { force: true }));

  it("reports the delta between consecutive agent_end baselines to the Cove run", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record);
    const sessionKey = "agent:kagura:cove:direct:1";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(100, 50, 0, 0.01)], success: true }, { sessionKey });
    expect(record).not.toHaveBeenCalled();
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(100, 50, 0, 0.01), usageMsg(1000, 500, 0, 0.05)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const [runId, usage] = record.mock.calls[0];
    expect(runId).toBe("cove-run-1");
    expect(usage).toMatchObject({
      provider: "floway-sg", model: "deepseek-v4-flash",
      input_tokens: 1000, output_tokens: 500,
      cost: 0.05, cost_source: "provider",
    });
  });

  it("reports the first agent_end of a Cove-created (fresh) session from a zero baseline", async () => {
    // #551 regression: a session created by this Cove run (new task thread,
    // one-shot subagent) has no pre-existing history, so its first agent_end's
    // cumulative usage IS the turn's consumption. The bridge claims it fresh;
    // the collector must report the full totals instead of silently setting a
    // baseline.
    const record = vi.fn().mockResolvedValue(undefined);
    const consumeFreshSession = vi.fn().mockReturnValue(true);
    const collector = newCollector(record, { consumeFreshSession });
    const sessionKey = "agent:kagura:cove:direct:thread-1";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(1000, 500, 0, 0.05)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(consumeFreshSession).toHaveBeenCalledWith(sessionKey);
    expect(record.mock.calls[0][0]).toBe("cove-run-1");
    expect(record.mock.calls[0][1]).toMatchObject({
      input_tokens: 1000, output_tokens: 500, cost: 0.05, cost_source: "provider",
    });

    // The claim is one-shot: the next turn is a normal delta from the baseline
    // established by the first report (cumulative 2500/1200 − baseline 1000/500).
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(1000, 500, 0, 0.05), usageMsg(1500, 700, 0, 0.07)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(record.mock.calls[1][1]).toMatchObject({ input_tokens: 1500, output_tokens: 700 });
  });

  it("reports the first agent_end of a fresh subagent session to its parent run", async () => {
    // #551: one-shot (mode=run) subagents fire a single agent_end; without the
    // fresh claim their entire consumption was dropped from the parent run's
    // aggregation.
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record, {
      runForSession: (key) => key === "agent:kagura:cove:direct:1" ? "cove-run-1" : null,
      parentSessionFor: (key) => key === "agent:kagura:subagent:child-1" ? "agent:kagura:cove:direct:1" : null,
      consumeFreshSession: (key) => key === "agent:kagura:subagent:child-1",
    });
    const childKey = "agent:kagura:subagent:child-1";
    collector.onAgentEnd({ runId: "c1", messages: [usageMsg(200, 100, 0, 0.02)], success: true }, { sessionKey: childKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][0]).toBe("cove-run-1");
    expect(record.mock.calls[0][1]).toMatchObject({ input_tokens: 200, output_tokens: 100 });
  });

  it("keeps silent baselines for pre-existing sessions even when the bridge later claims them", async () => {
    // A session observed before this process (restart/compaction recovery) has
    // a persisted baseline. Even when the fresh claim fires after restart, the
    // existing baseline must keep the session on the delta path — history is
    // never double counted (#551 boundary).
    const record = vi.fn().mockResolvedValue(undefined);
    const sessionKey = "agent:kagura:cove:direct:1";
    const b = (fresh: boolean) => bridge({
      runForSession: () => "cove-run-1",
      restForSession: () => ({ recordRunUsage: record }) as any,
      consumeFreshSession: () => fresh,
    });
    // c1 simulates the pre-upgrade process: no fresh claim, silent baseline.
    const c1 = new CoveUsageCollector(b(false), { warn: vi.fn() }, TEST_STATE);
    c1.onAgentEnd({ runId: "r1", messages: [usageMsg(100, 50)], success: true }, { sessionKey });
    expect(record).not.toHaveBeenCalled();

    // c2 simulates the new process after restart: the bridge claims the session
    // fresh, but the persisted baseline must win — only the delta is reported.
    const c2 = new CoveUsageCollector(b(true), { warn: vi.fn() }, TEST_STATE);
    c2.onAgentEnd({ runId: "r2", messages: [usageMsg(100, 50), usageMsg(1000, 500)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][1]).toMatchObject({ input_tokens: 1000, output_tokens: 500 });
  });

  it("trusts reported cost as-is (0 stays 0, no fallback)", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record);
    const sessionKey = "k";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(10, 5, 0, 0)], success: true }, { sessionKey });
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(10, 5, 0, 0), usageMsg(20, 10, 0, 0)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][1].cost).toBe(0);
    expect(record.mock.calls[0][1].cost_source).toBe("provider");
  });

  it("stores null cost with source none when provider reports no cost", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record);
    const sessionKey = "k";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(10, 5)], success: true }, { sessionKey });
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(10, 5), usageMsg(20, 10)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][1].cost).toBeNull();
    expect(record.mock.calls[0][1].cost_source).toBe("none");
  });

  it("attributes subagent usage to the parent run through the session chain", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record, {
      runForSession: (key) => key === "agent:kagura:cove:direct:1" ? "cove-run-1" : null,
      parentSessionFor: (key) => key === "agent:kagura:subagent:child-1" ? "agent:kagura:cove:direct:1" : null,
    });
    const childKey = "agent:kagura:subagent:child-1";
    collector.onAgentEnd({ runId: "c1", messages: [usageMsg(10, 5)], success: true }, { sessionKey: childKey });
    collector.onAgentEnd({ runId: "c2", messages: [usageMsg(10, 5), usageMsg(200, 100)], success: true }, { sessionKey: childKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][0]).toBe("cove-run-1");
    expect(record.mock.calls[0][1]).toMatchObject({ input_tokens: 200, output_tokens: 100 });
  });

  it("does not record when no run owns the session", async () => {
    const record = vi.fn();
    const collector = newCollector(record, { runForSession: () => null });
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(10, 5)], success: true }, { sessionKey: "no-such" });
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(10, 5), usageMsg(20, 10)], success: true }, { sessionKey: "no-such" });
    expect(record).not.toHaveBeenCalled();
  });

  it("skips turns with no new usage", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record);
    const sessionKey = "k";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(100, 50)], success: true }, { sessionKey });
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(100, 50)], success: true }, { sessionKey });
    expect(record).not.toHaveBeenCalled();
  });

  it("swallows record failures (observability must not break the turn)", async () => {
    const warn = vi.fn();
    const record = vi.fn().mockRejectedValue(new Error("network down"));
    const collector = newCollector(record, {}, warn);
    const sessionKey = "k";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(10, 5)], success: true }, { sessionKey });
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(10, 5), usageMsg(20, 10)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls.some((c: any) => String(c[0]).includes("failed to record run usage"))).toBe(true);
  });

  it("persists baselines and restores them after a simulated restart (no lost turn)", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const sessionKey = "agent:kagura:cove:direct:1";
    const b = () => bridge({
      runForSession: () => "cove-run-1",
      restForSession: () => ({ recordRunUsage: record }) as any,
    });

    const c1 = new CoveUsageCollector(b(), { warn: vi.fn() }, TEST_STATE);
    c1.onAgentEnd({ runId: "r1", messages: [usageMsg(100, 50)], success: true }, { sessionKey });
    expect(record).not.toHaveBeenCalled();

    const c2 = new CoveUsageCollector(b(), { warn: vi.fn() }, TEST_STATE);
    c2.onAgentEnd({ runId: "r2", messages: [usageMsg(100, 50), usageMsg(1000, 500)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][1]).toMatchObject({ input_tokens: 1000, output_tokens: 500 });
  });

  it("clamps negative cost delta to 0 and logs the regression (#586)", async () => {
    // #586: cumulative cost can regress between turns (message list trimmed /
    // usage recomputed) while cacheRead still grows. The raw delta would be a
    // negative cost; it must be clamped to 0 instead of under-reporting the run.
    const record = vi.fn().mockResolvedValue(undefined);
    const warn = vi.fn();
    const collector = newCollector(record, {}, warn);
    const sessionKey = "k";
    // Turn 1: baseline cost 0.05.
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(1000, 500, 0, 0.05)], success: true }, { sessionKey });
    expect(record).not.toHaveBeenCalled();
    // Turn 2: cost regressed to 0.027 but cacheRead grew 8064 → raw cost delta
    // is negative. Must report cacheRead with cost clamped to 0.
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(1000, 500, 8064, 0.027)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][1]).toMatchObject({
      input_tokens: 0, output_tokens: 0, cache_read_tokens: 8064,
      cost: 0, cost_source: "provider",
    });
    expect(warn.mock.calls.some((c: any) => String(c[0]).includes("usage baseline regression"))).toBe(true);
  });

  it("clamps negative token deltas to 0 as well (#586)", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record);
    const sessionKey = "k";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(1000, 500, 10000, 0.05)], success: true }, { sessionKey });
    expect(record).not.toHaveBeenCalled();
    // Input/output regressed (trimmed history) while cacheRead grew: only the
    // growth is reported, negatives never reach the wire.
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(500, 200, 16000, 0.03)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][1]).toMatchObject({
      input_tokens: 0, output_tokens: 0, cache_read_tokens: 6000,
      cost: 0,
    });
  });

  it("drops the turn entirely when every dimension regressed (#586)", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record);
    const sessionKey = "k";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(1000, 500, 10000, 0.05)], success: true }, { sessionKey });
    expect(record).not.toHaveBeenCalled();
    // Full regression: no positive delta anywhere → nothing to report.
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(900, 400, 9000, 0.04)], success: true }, { sessionKey });
    expect(record).not.toHaveBeenCalled();
  });

  it("keeps a positive cost delta untouched (#586 guard)", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record);
    const sessionKey = "k";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(1000, 500, 0, 0.05)], success: true }, { sessionKey });
    expect(record).not.toHaveBeenCalled();
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(1000, 500, 0, 0.05), usageMsg(2000, 900, 0, 0.09)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][1]).toMatchObject({ input_tokens: 2000, output_tokens: 900 });
    expect(record.mock.calls[0][1].cost).toBeCloseTo(0.09, 10);
  });

  it("reports full totals after a transcript rotation (new session id) instead of a negative delta (#588)", async () => {
    // #588: OpenClaw rotates the transcript (new session id) when the session
    // grows too large. Cumulative messages restart from zero, so diffing the
    // new session's totals against the pre-rotation baseline yields an
    // all-negative delta that would silently drop the entire run's usage.
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record);
    const sessionKey = "agent:kagura:cove:direct:thread-1";
    // Turn 1: old session id, 300k input (large history), silent baseline.
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(300000, 50000, 0, 1.5)], success: true }, { sessionKey, sessionId: "old-session-aaa" });
    expect(record).not.toHaveBeenCalled();
    // Turn 2: session rotated — new session id, cumulative totals restart from
    // the current turn's consumption (e.g. 15000 input). Must report the full
    // totals (15000), NOT a clamped-to-0 delta against 300000.
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(15000, 4000, 0, 0.08)], success: true }, { sessionKey, sessionId: "new-session-bbb" });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][0]).toBe("cove-run-1");
    expect(record.mock.calls[0][1]).toMatchObject({
      input_tokens: 15000, output_tokens: 4000, cost: 0.08, cost_source: "provider",
    });
    // Turn 3: same (rotated) session id — normal delta path from the new baseline.
    collector.onAgentEnd({ runId: "r3", messages: [usageMsg(18000, 4500, 0, 0.09)], success: true }, { sessionKey, sessionId: "new-session-bbb" });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(record.mock.calls[1][1]).toMatchObject({ input_tokens: 3000, output_tokens: 500 });
  });

  it("does not double-report after rotation when the run has no new usage (#588)", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record);
    const sessionKey = "agent:kagura:cove:direct:thread-1";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(1000, 500)], success: true }, { sessionKey, sessionId: "s1" });
    expect(record).not.toHaveBeenCalled();
    // Rotation with zero-total first turn (tool-only turn, no LLM call).
    collector.onAgentEnd({ runId: "r2", messages: [], success: true }, { sessionKey, sessionId: "s2" });
    expect(record).not.toHaveBeenCalled();
    // No baseline regression warning fired for the empty rotation.
    expect(record).not.toHaveBeenCalled();
  });

  it("ignores sessionId absence (null) and keeps using sessionKey identity (#588 guard)", async () => {
    // Some harness paths omit sessionId; identity must fall back to sessionKey
    // without treating a null sessionId as a rotation.
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record);
    const sessionKey = "k";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(100, 50)], success: true }, { sessionKey, sessionId: "s1" });
    expect(record).not.toHaveBeenCalled();
    // sessionId absent (undefined → null): NOT a rotation; normal delta path.
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(100, 50), usageMsg(500, 200)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][1]).toMatchObject({ input_tokens: 500, output_tokens: 200 });
  });

  it("persists sessionIds and detects rotation across a simulated restart (#588)", async () => {
    // #588 restart gap: sessionIds is memory-only, so after a gateway restart
    // the collector could not detect that the session had rotated — the first
    // agent_end after restart diffed the new session's small cumulative totals
    // against the pre-rotation baseline and dropped the run. The session id
    // map must survive restarts via the state file.
    const record = vi.fn().mockResolvedValue(undefined);
    const sessionKey = "agent:kagura:cove:direct:thread-1";
    const b = () => bridge({
      runForSession: () => "cove-run-1",
      restForSession: () => ({ recordRunUsage: record }) as any,
    });

    // Pre-restart: old session id, silent baseline.
    const c1 = new CoveUsageCollector(b(), { warn: vi.fn() }, TEST_STATE);
    c1.onAgentEnd({ runId: "r1", messages: [usageMsg(300000, 50000, 0, 1.5)], success: true }, { sessionKey, sessionId: "old-session-aaa" });
    expect(record).not.toHaveBeenCalled();

    // Simulated restart: new collector instance loads the persisted state
    // (including sessionIds) and sees the rotation — reports full totals.
    const c2 = new CoveUsageCollector(b(), { warn: vi.fn() }, TEST_STATE);
    c2.onAgentEnd({ runId: "r2", messages: [usageMsg(15000, 4000, 0, 0.08)], success: true }, { sessionKey, sessionId: "new-session-bbb" });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][1]).toMatchObject({ input_tokens: 15000, output_tokens: 4000, cost: 0.08 });
  });

  it("loads legacy v1 state (bare baselines map) without sessionIds (#588 compat)", async () => {
    // Upgrade path: the state file existed as a bare baselines map before this
    // change. Loading must not crash and must keep the delta path working.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(TEST_STATE, JSON.stringify({ "agent:kagura:cove:direct:1": { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.05, hasCost: true } }), { mode: 0o600 });
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = newCollector(record);
    const sessionKey = "agent:kagura:cove:direct:1";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(1000, 500, 0, 0.05), usageMsg(5000, 2000, 0, 0.2)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][1]).toMatchObject({ input_tokens: 5000, output_tokens: 2000 });
  });
});
