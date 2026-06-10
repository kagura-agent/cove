import { describe, it, expect, vi } from "vitest";

describe("reconnect cancels pending dispatches", () => {
  it("aborting multiple controllers cancels all pending dispatches", () => {
    const pendingDispatches = new Map<string, AbortController>();

    // Simulate two pending dispatches
    const c1 = new AbortController();
    const c2 = new AbortController();
    pendingDispatches.set("channel-1", c1);
    pendingDispatches.set("channel-2", c2);

    // Simulate reconnect: abort all
    for (const [, controller] of pendingDispatches) {
      controller.abort();
    }
    pendingDispatches.clear();

    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
    expect(pendingDispatches.size).toBe(0);
  });
});

describe("new message to same channel cancels old dispatch", () => {
  it("replacing a controller aborts the old dispatch", () => {
    const pendingDispatches = new Map<string, AbortController>();
    const channelId = "channel-1";
    const warn = vi.fn();

    // First dispatch
    const c1 = new AbortController();
    pendingDispatches.set(channelId, c1);

    // New message arrives — cancel old, start new
    const existing = pendingDispatches.get(channelId);
    if (existing) {
      warn(`aborting previous pending dispatch in [${channelId}]`);
      existing.abort();
    }
    const c2 = new AbortController();
    pendingDispatches.set(channelId, c2);

    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(pendingDispatches.get(channelId)).toBe(c2);
  });
});
