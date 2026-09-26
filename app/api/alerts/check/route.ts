import { NextRequest, NextResponse } from "next/server";
import { getActiveProvider } from "@/lib/api/registry";
import { clientIp, rateLimitResponse } from "@/lib/api/request-guard";
import { shouldTriggerAlert } from "@/lib/data/alert-events";
import { listActiveAlerts, triggerAlert } from "@/lib/db/alerts";
import { toCents } from "@/lib/db/money";
import { logEvent } from "@/lib/log";
import {
  clearFailures,
  failureBudgetVerdict,
  recordFailure,
  type RateLimitState,
} from "@/lib/rate-limit";
import { getLowestOffer } from "@/lib/pricing";
import { timingSafeStringEqual } from "@/lib/security/timing-safe";

export const dynamic = "force-dynamic";

/**
 * Evaluate every active alert against current prices.
 *
 * GET /api/alerts already refreshes the alerts of the person looking at them;
 * this endpoint is the sweep for everyone else — the job a scheduler runs so
 * a target reached at 3am is flagged without anyone having the page open. It
 * is idempotent: an alert already triggered is no longer active, so a second
 * run reports it as checked but does not touch it.
 *
 * Authorization always fails closed (§26): with no CRON_SECRET configured the
 * endpoint answers 503 — disabled, in every environment including local dev —
 * and with one configured, only `Authorization: Bearer <secret>` may call it
 * (401 otherwise). There is deliberately no "open in development" branch: a
 * check run writes to the database, and an environment variable flip should
 * never be what decides whether writes are exposed. The bearer comparison is
 * constant-time, and repeated wrong bearers count against a per-IP failure
 * budget so the secret cannot be guessed at volume.
 */
const AUTH_LIMIT = { limit: 10, windowMs: 60_000 };
const authFailures: RateLimitState = new Map();

async function handleCheck(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logEvent("warn", "alerts.cron.disabled", {});
    return NextResponse.json({ error: "cron check disabled" }, { status: 503 });
  }
  const key = `cron-check:${clientIp(request)}`;
  const budget = failureBudgetVerdict(authFailures, key, AUTH_LIMIT);
  if (!budget.allowed) {
    return rateLimitResponse(budget, "too many attempts")!;
  }
  if (!timingSafeStringEqual(request.headers.get("authorization"), `Bearer ${secret}`)) {
    recordFailure(authFailures, key, AUTH_LIMIT);
    logEvent("warn", "alerts.cron.denied", {});
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  clearFailures(authFailures, key);

  try {
    const alerts = await listActiveAlerts();
    const provider = getActiveProvider();
    const slugs = [...new Set(alerts.map((alert) => alert.product_slug))];
    const products = await Promise.all(
      slugs.map((slug) => provider.getProduct(slug)),
    );
    const priceBySlug = new Map(
      slugs.map((slug, index) => {
        const product = products[index] ?? null;
        const lowest = product ? getLowestOffer(product.offers) : null;
        return [slug, lowest ? toCents(lowest.price) : null];
      }),
    );

    let triggered = 0;
    for (const alert of alerts) {
      const current = priceBySlug.get(alert.product_slug) ?? null;
      if (!shouldTriggerAlert(alert.target_price_cents, current)) continue;
      if (await triggerAlert(alert.id)) triggered += 1;
    }

    logEvent("info", "alerts.cron.complete", {
      checked: alerts.length,
      triggered,
    });
    return NextResponse.json({
      checked: alerts.length,
      triggered,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    logEvent("error", "alerts.cron.failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "check failed" }, { status: 500 });
  }
}

// Vercel cron jobs send GET; manual callers (and the verification suites)
// send POST. Both take the identical fail-closed bearer path above — there is
// deliberately no method with weaker authorization.
export async function GET(request: NextRequest) {
  return handleCheck(request);
}

export async function POST(request: NextRequest) {
  return handleCheck(request);
}
