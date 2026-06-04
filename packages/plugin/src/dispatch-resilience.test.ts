import { describe, it, expect, vi } from "vitest";
import { createAbortableDispatch } from "./channel.js";

describe("createAbortableDispatch", () => {
  it("rejects after timeout when dispatch never resolves", async () => {
    const neverResolves = new Promise<void>(() => {});
    const controller = new AbortController();

    await expect(
      createAbortableDispatch(neverResolves, 50, controller.signal),
    ).rejects.toThrow("dispatch timeout");
  });

  it("resolves when dispatch completes before timeout", async () => {
    const fast = Promise.resolve();
    const controller = new AbortController();

    await expect(
      createAbortableDispatch(fast, 1000, controller.signal),
    ).resolves.toBeUndefined();
  });

  it("rejects when signal is aborted before dispatch completes", async () => {
    const neverResolves = new Promise<void>(() => {});
    const controller = new AbortController();

    const p = createAbortableDispatch(neverResolves, 5000, controller.signal);
    controller.abort();

    await expect(p).rejects.toThrow("dispatch aborted");
  });

  it("rejects immediately when signal is already aborted", async () => {
    const neverResolves = new Promise<void>(() => {});
    const controller = new AbortController();
    controller.abort();

    await expect(
      createAbortableDispatch(neverResolves, 5000, controller.signal),
    ).rejects.toThrow("dispatch aborted");
  });

  it("rejects with dispatch error when dispatch fails before timeout", async () => {
    const failing = Promise.reject(new Error("dispatch failed"));
    const controller = new AbortController();

    await expect(
      createAbortableDispatch(failing, 5000, controller.signal),
    ).rejects.toThrow("dispatch failed");
  });
});

describe("reconnect cancels pending dispatches", () => {
  it("aborting multiple controllers cancels all pending dispatches", async () => {
    const pendingDispatches = new Map<string, AbortController>();

    // Simulate two pending dispatches
    const c1 = new AbortController();
    const c2 = new AbortController();
    pendingDispatches.set("channel-1", c1);
    pendingDispatches.set("channel-2", c2);

    const p1 = createAbortableDispatch(new Promise<void>(() => {}), 60000, c1.signal);
    const p2 = createAbortableDispatch(new Promise<void>(() => {}), 60000, c2.signal);

    // Simulate reconnect: abort all
    for (const [, controller] of pendingDispatches) {
      controller.abort();
    }
    pendingDispatches.clear();

    await expect(p1).rejects.toThrow("dispatch aborted");
    await expect(p2).rejects.toThrow("dispatch aborted");
    expect(pendingDispatches.size).toBe(0);
  });
});

describe("new message to same channel cancels old dispatch", () => {
  it("replacing a controller aborts the old dispatch", async () => {
    const pendingDispatches = new Map<string, AbortController>();
    const channelId = "channel-1";
    const warn = vi.fn();

    // First dispatch
    const c1 = new AbortController();
    pendingDispatches.set(channelId, c1);
    const p1 = createAbortableDispatch(new Promise<void>(() => {}), 60000, c1.signal);

    // New message arrives — cancel old, start new
    const existing = pendingDispatches.get(channelId);
    if (existing) {
      warn(`aborting previous pending dispatch in [${channelId}]`);
      existing.abort();
    }
    const c2 = new AbortController();
    pendingDispatches.set(channelId, c2);

    await expect(p1).rejects.toThrow("dispatch aborted");
    expect(warn).toHaveBeenCalledOnce();
    expect(pendingDispatches.get(channelId)).toBe(c2);
  });
});
