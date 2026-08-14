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

describe("CoveUsageCollector", () => {
  it("attributes llm_output usage to the Cove run owning the session", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const collector = new CoveUsageCollector(bridge({
      runForSession: (key) => key === "agent:kagura:cove:direct:1" ? "cove-run-1" : null,
      restForSession: (key) => key === "agent:kagura:cove:direct:1" ? { recordRunUsage: record } as any : null,
    }));
    collector.onLlmOutput({
      runId: "native-run", sessionId: "s1", provider: "floway-sg", model: "deepseek-v4-flash",
      usage: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 100 },
    }, { sessionKey: "agent:kagura:cove:direct:1", sessionId: "s1", runId: "native-run" });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const [runId, usage] = record.mock.calls[0];
    expect(runId).toBe("cove-run-1");
    expect(usage).toMatchObject({
      provider: "floway-sg", model: "deepseek-v4-flash",
      input_tokens: 1000, output_tokens: 500, cache_read_tokens: 200, cache_write_tokens: 100,
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
    collector.onLlmOutput({
      runId: "child-run", sessionId: "child-session", provider: "p", model: "gpt-5-mini",
      usage: { input: 100, output: 50 },
    }, { sessionKey: "agent:kagura:subagent:child-1", sessionId: "child-session", runId: "child-run" });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0][0]).toBe("cove-run-1");
  });

  it("skips calls with no usage or zero tokens", () => {
    const record = vi.fn();
    const collector = new CoveUsageCollector(bridge({
      runForSession: () => "cove-run-1",
      restForSession: () => ({ recordRunUsage: record }) as any,
    }));
    collector.onLlmOutput({ runId: "r", sessionId: "s", provider: "p", model: "m" }, { sessionKey: "k" });
    collector.onLlmOutput({ runId: "r", sessionId: "s", provider: "p", model: "m", usage: { input: 0, output: 0 } }, { sessionKey: "k" });
    expect(record).not.toHaveBeenCalled();
  });

  it("does not record when no run owns the session", () => {
    const record = vi.fn();
    const collector = new CoveUsageCollector(bridge({ restForSession: () => ({ recordRunUsage: record }) as any }));
    collector.onLlmOutput({ runId: "r", sessionId: "s", provider: "p", model: "m", usage: { input: 10, output: 5 } }, { sessionKey: "no-such-session" });
    expect(record).not.toHaveBeenCalled();
  });

  it("swallows record failures (observability must not break the turn)", async () => {
    const warn = vi.fn();
    const record = vi.fn().mockRejectedValue(new Error("network down"));
    const collector = new CoveUsageCollector(bridge({
      runForSession: () => "cove-run-1",
      restForSession: () => ({ recordRunUsage: record }) as any,
    }), { warn });
    collector.onLlmOutput({ runId: "r", sessionId: "s", provider: "p", model: "m", usage: { input: 10, output: 5 } }, { sessionKey: "k" });
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
