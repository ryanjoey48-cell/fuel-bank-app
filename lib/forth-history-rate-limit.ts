/**
 * Simple in-memory rate limit for office Forth history endpoints.
 * Bounds concurrent and burst load; does not replace Forth upstream 429 handling.
 */

export type HistoryRateLimitResult =
  | { allowed: true; remaining: number; retryAfterSeconds: number | null }
  | { allowed: false; remaining: 0; retryAfterSeconds: number };

type Bucket = {
  windowStartedMs: number;
  count: number;
  inFlight: number;
};

const buckets = new Map<string, Bucket>();

export const FORTH_HISTORY_RATE_LIMIT_WINDOW_MS = 60_000;
export const FORTH_HISTORY_RATE_LIMIT_MAX_REQUESTS = 12;
export const FORTH_HISTORY_RATE_LIMIT_MAX_IN_FLIGHT = 1;

export function resetForthHistoryRateLimitForTests() {
  buckets.clear();
}

function getBucket(key: string, nowMs: number): Bucket {
  const existing = buckets.get(key);
  if (!existing || nowMs - existing.windowStartedMs >= FORTH_HISTORY_RATE_LIMIT_WINDOW_MS) {
    const fresh: Bucket = { windowStartedMs: nowMs, count: 0, inFlight: 0 };
    buckets.set(key, fresh);
    return fresh;
  }
  return existing;
}

/** Begin a history request; caller must invoke release on settle. */
export function beginForthHistoryRateLimit(
  key: string,
  nowMs: number = Date.now()
): HistoryRateLimitResult {
  const bucket = getBucket(key, nowMs);
  if (bucket.inFlight >= FORTH_HISTORY_RATE_LIMIT_MAX_IN_FLIGHT) {
    return { allowed: false, remaining: 0, retryAfterSeconds: 2 };
  }
  if (bucket.count >= FORTH_HISTORY_RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.windowStartedMs + FORTH_HISTORY_RATE_LIMIT_WINDOW_MS - nowMs) / 1000)
    );
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  bucket.count += 1;
  bucket.inFlight += 1;
  return {
    allowed: true,
    remaining: Math.max(0, FORTH_HISTORY_RATE_LIMIT_MAX_REQUESTS - bucket.count),
    retryAfterSeconds: null
  };
}

export function releaseForthHistoryRateLimit(key: string, nowMs: number = Date.now()) {
  const bucket = buckets.get(key);
  if (!bucket) return;
  if (nowMs - bucket.windowStartedMs >= FORTH_HISTORY_RATE_LIMIT_WINDOW_MS) {
    buckets.delete(key);
    return;
  }
  bucket.inFlight = Math.max(0, bucket.inFlight - 1);
}
