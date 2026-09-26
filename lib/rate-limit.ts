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
 * Current coverage (Live Data Readiness §10): /api/search, /api/suggestions,
 * /api/views, alert filing, /api/admin/session, ingest auth, cron auth, and
 * /go — plus the failure budgets in this file for the secret endpoints. All
 * are instance-local, which is honest at this scale: one deployment, modest
 * traffic. A shared store (Redis or similar) becomes worth its complexity
 * only when multiple instances must share ONE budget for the same key —
 * i.e. when login-lockout or ingest-lockout can be walked around by landing
 * on a different instance. Until then, adding distributed state would be
 * complexity without a business reason.
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

/**
 * Keep the map bounded even under a flood of fresh keys: sweep what has
 * expired, and if the map is still full, drop the oldest entries (Map keeps
 * insertion order) rather than growing without limit.
 */
function makeRoom(state: RateLimitState, now: number): void {
  if (state.size < MAX_BUCKETS) return;
  for (const [otherKey, other] of state) {
    if (other.resetAt <= now) state.delete(otherKey);
  }
  while (state.size >= MAX_BUCKETS) {
    const oldest = state.keys().next();
    if (oldest.done) break;
    state.delete(oldest.value);
  }
}

export function consumeRateLimit(
  state: RateLimitState,
  key: string,
  options: { limit: number; windowMs: number },
  now: number = Date.now(),
): RateLimitVerdict {
  const bucket = state.get(key);

  if (!bucket || bucket.resetAt <= now) {
    makeRoom(state, now);
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

/**
 * Failure-counting budgets for secret-verifying endpoints (admin login,
 * ingest, cron). Unlike consumeRateLimit these do not charge for every
 * request — a legitimate caller who succeeds never accumulates anything —
 * so the limit only bites on repeated wrong secrets: check the budget before
 * verifying, record a failure on a mismatch, and clear the key on success.
 */
export function failureBudgetVerdict(
  state: RateLimitState,
  key: string,
  options: { limit: number; windowMs: number },
  now: number = Date.now(),
): RateLimitVerdict {
  const bucket = state.get(key);
  if (!bucket || bucket.resetAt <= now) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.count >= options.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFailure(
  state: RateLimitState,
  key: string,
  options: { limit: number; windowMs: number },
  now: number = Date.now(),
): void {
  const bucket = state.get(key);
  if (!bucket || bucket.resetAt <= now) {
    makeRoom(state, now);
    state.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }
  bucket.count += 1;
}

/** A correct secret wipes the budget so real callers never lock themselves out. */
export function clearFailures(state: RateLimitState, key: string): void {
  state.delete(key);
}
