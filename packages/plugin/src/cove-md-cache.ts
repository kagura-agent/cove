import type { CoveRestClient } from "./rest-client.js";

interface CacheEntry {
  content: string | null;  // null = confirmed no cove.md
  fetchedAt: number;
  lastAccessedAt: number;
}

const TTL_MS = 60_000; // 1 minute TTL
const MAX_ENTRIES = 500;
const cache = new Map<string, CacheEntry>();

function evictIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return;
  // Evict oldest accessed entries
  const entries = [...cache.entries()].sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
  const toRemove = entries.slice(0, cache.size - MAX_ENTRIES);
  for (const [key] of toRemove) {
    cache.delete(key);
  }
}

export async function getCoveMd(
  restClient: CoveRestClient,
  channelId: string,
  log?: { warn?: (...a: any[]) => void },
): Promise<string | null> {
  const cached = cache.get(channelId);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    cached.lastAccessedAt = Date.now();
    return cached.content;
  }

  try {
    const file = await restClient.getChannelFile(channelId, "cove.md", AbortSignal.timeout(2000));
    const content = file?.content && Buffer.byteLength(file.content, "utf8") <= 8000
      ? file.content
      : null;
    const now = Date.now();
    cache.set(channelId, { content, fetchedAt: now, lastAccessedAt: now });
    evictIfNeeded();
    return content;
  } catch (err) {
    log?.warn?.(`cove: failed to fetch cove.md for [${channelId}]: ${err instanceof Error ? err.message : err}`);
    // On error, return stale cache if available, otherwise null
    return cached?.content ?? null;
  }
}

export function invalidateCoveMd(channelId: string): void {
  cache.delete(channelId);
}

export function invalidateAllCoveMd(): void {
  cache.clear();
}
