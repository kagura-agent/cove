import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../auth.js";

// ---------------------------------------------------------------------------
// Token-bucket rate limiter — Discord-compatible X-RateLimit-* headers
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  lastRefill: number; // ms timestamp
}

interface BucketConfig {
  limit: number;   // max tokens (= requests)
  refillRate: number; // tokens per second
  id: string;      // header value for X-RateLimit-Bucket
}

const GLOBAL_BUCKET: BucketConfig = { limit: 50, refillRate: 50, id: "global" };
const CHANNEL_WRITE_BUCKET: BucketConfig = { limit: 5, refillRate: 5, id: "channel_write" };

// Write methods that count against the channel-write bucket
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Pattern to match channel-scoped write endpoints
const CHANNEL_WRITE_RE = /\/channels\/[^/]+\/messages/;

/** Map<"userId:bucketId", Bucket> */
const buckets = new Map<string, Bucket>();

// Periodic cleanup — remove entries untouched for >60 s
const CLEANUP_INTERVAL_MS = 60_000;
const STALE_MS = 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | undefined;

function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (now - b.lastRefill > STALE_MS) buckets.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  // Allow Node to exit even if the timer is running
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/** Consume one token. Returns remaining tokens (may be negative if exhausted). */
function consume(key: string, cfg: BucketConfig, now: number): { remaining: number; resetMs: number } {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: cfg.limit, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Lazy refill
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(cfg.limit, bucket.tokens + elapsed * cfg.refillRate);
  bucket.lastRefill = now;

  // Consume
  bucket.tokens -= 1;
  const remaining = bucket.tokens;

  // Time until next token is available (not full refill)
  const tokensNeeded = Math.max(0, 1 - bucket.tokens);
  const resetMs = tokensNeeded > 0 ? (tokensNeeded / cfg.refillRate) * 1000 : 0;

  return { remaining, resetMs };
}

function setRateLimitHeaders(
  headers: Headers,
  cfg: BucketConfig,
  remaining: number,
  resetMs: number,
): void {
  headers.set("X-RateLimit-Limit", String(cfg.limit));
  headers.set("X-RateLimit-Remaining", String(Math.max(0, Math.floor(remaining))));
  const resetEpoch = Math.ceil((Date.now() + resetMs) / 1000);
  headers.set("X-RateLimit-Reset", String(resetEpoch));
  headers.set("X-RateLimit-Reset-After", (resetMs / 1000).toFixed(3));
  headers.set("X-RateLimit-Bucket", cfg.id);
}

/** Exported for testing — clear all buckets */
export function resetBuckets(): void {
  buckets.clear();
}

export function rateLimitMiddleware(): MiddlewareHandler<AppEnv> {
  ensureCleanup();

  return async (c, next) => {
    // Check env flag (default: enabled)
    const envFlag = process.env.RATE_LIMIT_ENABLED;
    if (envFlag === "false" || envFlag === "0") {
      return next();
    }

    // Need an authenticated user — skip if not present
    const user = c.get("botUser");
    if (!user) return next();

    const now = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    // Determine which bucket to check first (most restrictive)
    const isChannelWrite = WRITE_METHODS.has(method) && CHANNEL_WRITE_RE.test(path);
    const activeCfg = isChannelWrite ? CHANNEL_WRITE_BUCKET : GLOBAL_BUCKET;
    const bucketKey = `${user.id}:${activeCfg.id}`;

    const { remaining, resetMs } = consume(bucketKey, activeCfg, now);

    // Also consume from global if we used the write bucket, and check both
    let globalRemaining = Infinity;
    let globalResetMs = 0;
    if (isChannelWrite) {
      const globalResult = consume(`${user.id}:${GLOBAL_BUCKET.id}`, GLOBAL_BUCKET, now);
      globalRemaining = globalResult.remaining;
      globalResetMs = globalResult.resetMs;
    }

    // Check if either bucket is exhausted
    const exhaustedByChannel = remaining < 0;
    const exhaustedByGlobal = isChannelWrite && globalRemaining < 0;

    if (exhaustedByChannel || exhaustedByGlobal) {
      // Use the more restrictive bucket for the response
      const useCfg = exhaustedByChannel ? activeCfg : GLOBAL_BUCKET;
      const useRemaining = exhaustedByChannel ? remaining : globalRemaining;
      const useResetMs = exhaustedByChannel ? resetMs : globalResetMs;
      // Rate limited — compute retry_after (time until 1 token available)
      const retryAfter = Math.max(0, (1 - (useRemaining + 1)) / useCfg.refillRate);
      const retryAfterSec = parseFloat(retryAfter.toFixed(3));

      const res = c.json(
        {
          message: "You are being rate limited.",
          retry_after: retryAfterSec,
          global: exhaustedByGlobal && !exhaustedByChannel,
          code: 0,
        },
        429,
      );
      setRateLimitHeaders(res.headers, useCfg, useRemaining, useResetMs);
      res.headers.set("Retry-After", String(Math.ceil(retryAfterSec)));
      return res;
    }

    // Proceed with normal request
    await next();

    // Set rate-limit headers on the actual response
    setRateLimitHeaders(c.res.headers, activeCfg, remaining, resetMs);
  };
}
