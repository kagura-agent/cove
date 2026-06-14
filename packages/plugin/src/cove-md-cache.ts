import type { CoveRestClient } from "./rest-client.js";

interface CacheEntry {
  content: string | null;  // null = confirmed no cove.md
  fetchedAt: number;
}

const TTL_MS = 60_000; // 1 minute TTL
const cache = new Map<string, CacheEntry>();

export async function getCoveMd(
  restClient: CoveRestClient,
  channelId: string,
  log?: { warn?: (...a: any[]) => void },
): Promise<string | null> {
  const cached = cache.get(channelId);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.content;
  }

  try {
    const file = await restClient.getChannelFile(channelId, "cove.md", AbortSignal.timeout(2000));
    const content = file?.content && Buffer.byteLength(file.content, "utf8") <= 8000
      ? file.content
      : null;
    cache.set(channelId, { content, fetchedAt: Date.now() });
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
