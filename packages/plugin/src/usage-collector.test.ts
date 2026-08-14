import { describe, expect, it, vi } from "vitest";
import { CoveUsageCollector, type UsageBridge } from "./usage-collector.js";
import { estimateCost, priceForModel } from "./model-prices.js";

function bridge(overrides: Partial<UsageBridge> = {}): UsageBridge {
  return {
    runForSession: () => null,
    parentSessionFor: () => null,
    restForSession: () => null,
    ...overrides,
  };
}

function usageMsg(input: number, output: number, cacheRead = 0, model = "deepseek-v4-flash") {
  return { role: "assistant" as const, provider: "floway-sg", model, usage: { input, output, cacheRead, cacheWrite: 0 } };
}

describe("CoveUsageCollector (agent_end source)", () => {
  it("reports the delta between consecutive agent_end baselines to the Cove run", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = new CoveUsageCollector(bridge({
      runForSession: (key) => key === "agent:kagura:cove:direct:1" ? "cove-run-1" : null,
      restForSession: (key) => key === "agent:kagura:cove:direct:1" ? { recordRunUsage: record } as any : null,
    }));
    const sessionKey = "agent:kagura:cove:direct:1";
    // First end: establishes baseline (cumulative history), reports nothing.
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(100, 50)], success: true }, { sessionKey });
    expect(record).not.toHaveBeenCalled();
    // Second end: delta = new messages only.
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(100, 50), usageMsg(1000, 500)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const [runId, usage] = record.mock.calls[0];
    expect(runId).toBe("cove-run-1");
    expect(usage).toMatchObject({
      provider: "floway-sg", model: "deepseek-v4-flash",
      input_tokens: 1000, output_tokens: 500,
      cost_source: "price_table",
    });
    expect(usage.cost).toBeGreaterThan(0);
  });

  it("attributes subagent usage to the parent run through the session chain", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = new CoveUsageCollector(bridge({
      runForSession: (key) => key === "agent:kagura:cove:direct:1" ? "cove-run-1" : null,
      parentSessionFor: (key) => key === "agent:kagura:subagent:child-1" ? "agent:kagura:cove:direct:1" : null,
      restForSession: (key) => key === "agent:kagura:cove:direct:1" ? { recordRunUsage: record } as any : null,
    }));
    const childKey = "agent:kagura:subagent:child-1";
    collector.onAgentEnd({ runId: "c1", messages: [usageMsg(10, 5)], success: true }, { sessionKey: childKey });
    collector.onAgentEnd({ runId: "c2", messages: [usageMsg(10, 5), usageMsg(200, 100)], success: true }, { sessionKey: childKey });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][0]).toBe("cove-run-1");
    expect(record.mock.calls[0][1]).toMatchObject({ input_tokens: 200, output_tokens: 100 });
  });

  it("does not record when no run owns the session", async () => {
    const record = vi.fn();
    const collector = new CoveUsageCollector(bridge({ restForSession: () => ({ recordRunUsage: record }) as any }));
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(10, 5)], success: true }, { sessionKey: "no-such" });
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(10, 5), usageMsg(20, 10)], success: true }, { sessionKey: "no-such" });
    expect(record).not.toHaveBeenCalled();
  });

  it("skips turns with no new usage", async () => {
    const record = vi.fn();
    const collector = new CoveUsageCollector(bridge({
      runForSession: () => "cove-run-1",
      restForSession: () => ({ recordRunUsage: record }) as any,
    }));
    const sessionKey = "k";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(100, 50)], success: true }, { sessionKey });
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(100, 50)], success: true }, { sessionKey });
    expect(record).not.toHaveBeenCalled();
  });

  it("swallows record failures (observability must not break the turn)", async () => {
    const warn = vi.fn();
    const record = vi.fn().mockRejectedValue(new Error("network down"));
    const collector = new CoveUsageCollector(bridge({
      runForSession: () => "cove-run-1",
      restForSession: () => ({ recordRunUsage: record }) as any,
    }), { warn });
    const sessionKey = "k";
    collector.onAgentEnd({ runId: "r1", messages: [usageMsg(10, 5)], success: true }, { sessionKey });
    collector.onAgentEnd({ runId: "r2", messages: [usageMsg(10, 5), usageMsg(20, 10)], success: true }, { sessionKey });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls[0][0]).toContain("failed to record run usage");
  });
});

describe("model price table", () => {
  it("resolves exact and prefixed model refs", () => {
    expect(priceForModel("deepseek-v4-flash")).not.toBeNull();
    expect(priceForModel("floway-sg/deepseek-v4-flash")).not.toBeNull();
    expect(priceForModel("openai/gpt-5-mini")).not.toBeNull();
    expect(priceForModel("totally-unknown-model")).toBeNull();
  });

  it("estimates cost from token counts", () => {
    const cost = estimateCost({ model: "gpt-5-mini", inputTokens: 1_000_000, outputTokens: 500_000 });
    // 1M input × $0.25/M + 500K output × $2/M = 0.25 + 1.00
    expect(cost).toBeCloseTo(1.25, 5);
  });

  it("returns null for unknown models", () => {
    expect(estimateCost({ model: "unknown", inputTokens: 100, outputTokens: 50 })).toBeNull();
  });
});
