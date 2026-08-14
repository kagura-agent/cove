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
});
