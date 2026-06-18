/**
 * Behavioral contract tests for message-queue.ts (Phase 0.6 of #398).
 *
 * Covers contracts G1, G2, G4, G5 from SPEC-398.md Section 2.G.
 * G3 is tested in dispatch-behavior.test.ts (requires dispatch wiring).
 *
 * ChannelMessageQueue is a pure class with no SDK dependencies, so we
 * instantiate it directly and feed it Message objects rather than mocking
 * dispatch.ts.
 */

import { describe, it, expect, vi } from "vitest";
import { ChannelMessageQueue } from "./message-queue.js";
import type { Message } from "@cove/shared";

const CHANNEL_ID = "ch-1";

function msg(id: string, content = `m-${id}`): Message {
  return {
    id,
    channel_id: CHANNEL_ID,
    content,
    timestamp: new Date().toISOString(),
    author: { id: "user-1", username: "tester", global_name: "tester" },
    attachments: [],
  } as unknown as Message;
}

/** Promise that resolves only when caller invokes the returned release(). */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((r) => { release = r; });
  return { promise, release };
}

describe("G. Batched Messages — message-queue contract", () => {
  it("G1: queue serializes per-channel (only one dispatch in flight at a time)", async () => {
    const calls: string[] = [];
    const inflight = new Set<string>();
    let maxConcurrent = 0;
    const gate = deferred();

    const queue = new ChannelMessageQueue({
      dispatchFn: async (m) => {
        inflight.add(m.id);
        maxConcurrent = Math.max(maxConcurrent, inflight.size);
        calls.push(m.id);
        await gate.promise;
        inflight.delete(m.id);
      },
    });

    queue.enqueue(msg("1"));
    // Force second enqueue while first is still in dispatchFn (gate not released)
    await new Promise((r) => setTimeout(r, 5));
    queue.enqueue(msg("2"));
    await new Promise((r) => setTimeout(r, 5));

    expect(inflight.size).toBe(1);
    expect(maxConcurrent).toBe(1);
    gate.release();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual(["1", "2"]);
  });

  it("G2: multiple queued messages trigger batchDispatchFn (not per-message dispatch)", async () => {
    const dispatchCalls: string[] = [];
    const batchCalls: string[][] = [];
    const gate = deferred();

    const queue = new ChannelMessageQueue({
      dispatchFn: async (m) => {
        dispatchCalls.push(m.id);
        // First message blocks long enough for two more to enqueue
        if (m.id === "1") await gate.promise;
      },
      batchDispatchFn: async (msgs) => {
        batchCalls.push(msgs.map((m) => m.id));
      },
    });

    queue.enqueue(msg("1"));
    await new Promise((r) => setTimeout(r, 5));
    // While "1" is in dispatchFn, enqueue 2 and 3 → they should batch
    queue.enqueue(msg("2"));
    queue.enqueue(msg("3"));
    gate.release();
    await new Promise((r) => setTimeout(r, 30));

    // "1" goes through dispatchFn (single item drain), then "2"+"3" batch
    expect(dispatchCalls).toEqual(["1"]);
    expect(batchCalls).toEqual([["2", "3"]]);
  });

  it("G4: queue max = 5; oldest dropped on overflow", async () => {
    const warnings: string[] = [];
    const gate = deferred();

    const queue = new ChannelMessageQueue({
      dispatchFn: async () => {
        await gate.promise;
      },
      batchDispatchFn: async () => {
        await gate.promise;
      },
      log: { warn: (s: string) => warnings.push(s) },
    });

    // First enqueue starts dispatching (blocked on gate). Subsequent 6 fill the queue.
    queue.enqueue(msg("1"));
    await new Promise((r) => setTimeout(r, 5));
    expect(queue.size(CHANNEL_ID)).toBe(0); // "1" already taken into dispatchFn

    for (let i = 2; i <= 8; i++) queue.enqueue(msg(String(i)));
    // 7 enqueues during in-flight dispatch: queue caps at 5, drops 2 oldest
    expect(queue.size(CHANNEL_ID)).toBe(5);
    expect(warnings.filter((w) => w.includes("queue full")).length).toBe(2);
    gate.release();
    await new Promise((r) => setTimeout(r, 30));
  });

  it("G5: clearAll() empties all queues (used on hard reconnect)", () => {
    const queue = new ChannelMessageQueue({
      dispatchFn: async () => { await new Promise((r) => setTimeout(r, 100)); },
    });
    // Don't actually trigger dispatch — just stage queued state
    // by enqueuing into channels that are already "processing"
    queue.enqueue(msg("a"));
    // Synchronously enqueue same channel — sits in queue while first dispatches
    queue.enqueue(msg("b"));
    queue.enqueue(msg("c"));
    // size measures queued items waiting; first one is in flight, b+c queued
    expect(queue.size(CHANNEL_ID)).toBeGreaterThanOrEqual(2);

    queue.clearAll();
    expect(queue.size(CHANNEL_ID)).toBe(0);
  });
});
