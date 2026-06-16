/**
 * Prune a Set to keep only the newest half when it exceeds maxSize.
 */
export function pruneSetIfNeeded<T>(set: Set<T>, maxSize: number): void {
  if (set.size <= maxSize) return;
  const entries = [...set];
  set.clear();
  for (let i = Math.floor(entries.length / 2); i < entries.length; i++) {
    set.add(entries[i]);
  }
}
