import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskUsageStore } from "./useTaskUsageStore";
import { dispatcher } from "../lib/gateway-dispatcher";
import * as api from "../lib/api";

const usageA = { calls: 1, input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 15, cost: 0.01, currency: "USD", cost_source: "price_table" as const, models: [] };

vi.spyOn(api, "fetchTaskUsages").mockImplementation(async (channelId: string) => {
  return { [`task-${channelId}`]: usageA };
});

beforeEach(() => {
  useTaskUsageStore.setState({ byChannel: {} });
  vi.clearAllMocks();
});

describe("useTaskUsageStore", () => {
  it("fetchChannel populates byChannel keyed by task_id", async () => {
    await useTaskUsageStore.getState().fetchChannel("c1");
    expect(useTaskUsageStore.getState().byChannel["c1"]).toEqual({ "task-c1": usageA });
  });

  it("is idempotent while cached — second fetch is a no-op", async () => {
    await useTaskUsageStore.getState().fetchChannel("c1");
    await useTaskUsageStore.getState().fetchChannel("c1");
    expect(api.fetchTaskUsages).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent in-flight fetches", async () => {
    const p1 = useTaskUsageStore.getState().fetchChannel("c1");
    const p2 = useTaskUsageStore.getState().fetchChannel("c1");
    await Promise.all([p1, p2]);
    expect(api.fetchTaskUsages).toHaveBeenCalledTimes(1);
  });

  it("invalidateChannel drops the cache so the next fetch refetches", async () => {
    await useTaskUsageStore.getState().fetchChannel("c1");
    useTaskUsageStore.getState().invalidateChannel("c1");
    expect(useTaskUsageStore.getState().byChannel["c1"]).toBeUndefined();
    await useTaskUsageStore.getState().fetchChannel("c1");
    expect(api.fetchTaskUsages).toHaveBeenCalledTimes(2);
  });

  it("AGENT_USAGE_UPDATED invalidates and refetches the affected channel", async () => {
    await useTaskUsageStore.getState().fetchChannel("c1");
    dispatcher.emit("AGENT_USAGE_UPDATED", { channel_id: "c1" } as never);
    // Allow the async refetch to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(api.fetchTaskUsages).toHaveBeenCalledTimes(2);
    expect(useTaskUsageStore.getState().byChannel["c1"]).toEqual({ "task-c1": usageA });
  });
});
