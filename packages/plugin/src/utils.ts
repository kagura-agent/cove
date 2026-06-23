/**
 * Shared utilities for the Cove channel plugin.
 */

/**
 * Merge multiple abort signals into a single signal that aborts when any source fires.
 *
 * Unlike `AbortSignal.any()`:
 * - Filters out `undefined`/`null` signals (AbortSignal.any throws on undefined)
 * - Returns `undefined` when no valid signals (AbortSignal.any([]) returns a never-abort signal)
 * - Short-circuits for single signal (no wrapping overhead)
 */
export function mergeAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => Boolean(s));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(active);
  const controller = new AbortController();
  for (const signal of active) if (signal.aborted) { controller.abort(); return controller.signal; }
  const onAbort = () => { controller.abort(); for (const s of active) s.removeEventListener("abort", onAbort); };
  for (const signal of active) signal.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}
