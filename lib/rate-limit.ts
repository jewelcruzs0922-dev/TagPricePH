/**
 * A minimal fixed-window rate limiter for the alert API (§25: per-IP POST
 * limit).
 *
 * Deliberately in-memory: there is no Redis in this stack, and the thing being
 * protected — minting mailbox tokens — only needs to slow down a single
 * address hammering one deployment, not survive across serverless instances.
 * Each instance counts for itself; that weakness is documented rather than
 * hidden behind a cache that does not exist.
 *
 * The state map is owned by the caller (the route module), and `now` is a
 * parameter so verification can drive the window from plain Node without
 * sleeping — the same testability rule the rest of the codebase follows.
 */

export type RateLimitState = Map<string, { count: number; resetAt: number }>;

export type RateLimitVerdict = {
  allowed: boolean;
  /** Whole seconds until the window resets — 0 while allowed. */
  retryAfterSeconds: number;
};

/** Bound the state map: expired buckets are swept once it grows large. */
const MAX_BUCKETS = 10_000;

export function consumeRateLimit(
  state: RateLimitState,
  key: string,
  options: { limit: number; windowMs: number },
  now: number = Date.now(),
): RateLimitVerdict {
  const bucket = state.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (state.size >= MAX_BUCKETS) {
      for (const [otherKey, other] of state) {
        if (other.resetAt <= now) state.delete(otherKey);
      }
    }
    state.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= options.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
