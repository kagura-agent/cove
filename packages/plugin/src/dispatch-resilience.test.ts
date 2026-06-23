import { describe, it, expect } from "vitest";
import { mergeAbortSignals } from "./utils.js";

describe("abortSignal lifecycle patterns", () => {
  it("aborting a signal is reflected by isAborted check", () => {
    const controller = new AbortController();
    const isAborted = () => Boolean(controller.signal.aborted);

    expect(isAborted()).toBe(false);
    controller.abort();
    expect(isAborted()).toBe(true);
  });

  it("isAborted returns false when abortSignal is undefined (graceful degradation)", () => {
    const abortSignal = undefined as AbortSignal | undefined;
    const isAborted = () => Boolean(abortSignal?.aborted);

    expect(isAborted()).toBe(false);
  });
});

describe("mergeAbortSignals", () => {
  it("returns undefined when all signals are undefined", () => {
    expect(mergeAbortSignals([undefined, undefined])).toBeUndefined();
  });

  it("returns the single signal when only one is defined", () => {
    const controller = new AbortController();
    const merged = mergeAbortSignals([undefined, controller.signal]);
    expect(merged).toBe(controller.signal);
  });

  it("merged signal aborts when first source signal fires", () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const merged = mergeAbortSignals([c1.signal, c2.signal]);
    expect(merged?.aborted).toBe(false);

    c1.abort();
    expect(merged?.aborted).toBe(true);
  });

  it("merged signal aborts when second source signal fires", () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const merged = mergeAbortSignals([c1.signal, c2.signal]);
    expect(merged?.aborted).toBe(false);

    c2.abort();
    expect(merged?.aborted).toBe(true);
  });

  it("merged signal is already aborted if a source is pre-aborted", () => {
    const c1 = new AbortController();
    c1.abort();
    const c2 = new AbortController();
    const merged = mergeAbortSignals([c1.signal, c2.signal]);
    expect(merged?.aborted).toBe(true);
  });

  it("returns undefined for empty array", () => {
    expect(mergeAbortSignals([])).toBeUndefined();
  });
});
