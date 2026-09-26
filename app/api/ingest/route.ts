import { NextRequest, NextResponse } from "next/server";
import { getActiveProvider, getRegisteredProviderIds } from "@/lib/api/registry";
import { clientIp, rateLimitResponse } from "@/lib/api/request-guard";
import { planIngestion, providerRefusal, rowKey, screenRows } from "@/lib/data/ingest";
import { query } from "@/lib/db";
import { syncCatalog } from "@/lib/db/catalog-sync";
import { fromCents } from "@/lib/db/money";
import { recordObservations } from "@/lib/db/observations";
import { LAST_PRICES_SQL } from "@/lib/db/observation-queries";
import { logEvent } from "@/lib/log";
import {
  clearFailures,
  failureBudgetVerdict,
  recordFailure,
  type RateLimitState,
} from "@/lib/rate-limit";
import { timingSafeStringEqual } from "@/lib/security/timing-safe";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The ingestion endpoint — the one place marketplace readings enter the
 * observation store.
 *
 * Two independent locks, both of which must open before a row is written:
 *
 *  1. Authentication. With no INGEST_SECRET configured the route answers 404,
 *     as though it did not exist; with one configured, a matching
 *     `x-ingest-secret` or `Authorization: Bearer` header is required.
 *  2. Authorization. The active provider must be one that may report real
 *     prices. That check is `providerRefusal` — the same function
 *     `planIngestion` uses, not a second copy that could drift from it.
 *
 * A refusal is an honest 200 with `ok: false` and a reason, because "there is
 * nothing authorized to ingest" is the expected answer today, not a failure.
 *
 * Intended to be driven by a scheduler (Vercel cron) or by hand:
 *   curl -H "x-ingest-secret: $INGEST_SECRET" https://host/api/ingest
 */
function matchesSecret(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("x-ingest-secret");
  if (header && timingSafeStringEqual(header, secret)) return true;

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return timingSafeStringEqual(authorization.slice("Bearer ".length), secret);
  }
  return false;
}

/** Wrong secrets count against a per-IP budget; a right one clears it. */
const AUTH_LIMIT = { limit: 10, windowMs: 60_000 };
const authFailures: RateLimitState = new Map();

async function ingest(request: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  }
  const key = `ingest:${clientIp(request)}`;
  const budget = failureBudgetVerdict(authFailures, key, AUTH_LIMIT);
  if (!budget.allowed) {
    return rateLimitResponse(budget, "too many attempts")!;
  }
  if (!matchesSecret(request, secret)) {
    recordFailure(authFailures, key, AUTH_LIMIT);
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  clearFailures(authFailures, key);

  try {
    let provider;
    try {
      provider = getActiveProvider();
    } catch (error) {
      const registered = getRegisteredProviderIds().join(", ") || "none";
      logEvent("warn", "ingest.no-provider", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        {
          ok: false,
          reason: `No marketplace provider is registered under DATA_PROVIDER. Registered: ${registered}.`,
        },
        { headers: NO_STORE },
      );
    }

    const refusal = providerRefusal(provider);
    if (refusal) {
      logEvent("warn", "ingest.refused", { provider: provider.id, reason: refusal });
      return NextResponse.json(
        { ok: false, provider: provider.id, ingested: 0, reason: refusal },
        { headers: NO_STORE },
      );
    }

    const products = await provider.listProducts();

    // Catalog half of the run (§19): products/listings/offers land in the
    // read model first, in one transaction, so the observations recorded
    // below are backed by rows the DB provider can serve. A catalog failure
    // aborts the run before any observation is written.
    const catalog = await syncCatalog(products, provider.source);

    const rows = [];
    let refusedProducts = 0;

    for (const product of products) {
      const plan = planIngestion(provider, product);
      if (plan.authorized) {
        rows.push(...plan.rows);
      } else {
        refusedProducts += 1;
      }
    }

    // Phase 18 screening: impossible readings (non-positive, future,
    // duplicated, or beyond the plausibility limit against the last recorded
    // price) are refused per row and reported — never written, never hidden.
    const slugs = [...new Set(rows.map((row) => row.productSlug))];
    const storeIds = [...new Set(rows.map((row) => row.storeId))];
    const previousRows =
      rows.length > 0
        ? await query<{ product_slug: string; store_id: string; price_cents: number }>(
            LAST_PRICES_SQL,
            [slugs, storeIds],
          )
        : [];
    const previous = new Map(
      previousRows.map((row) => [
        rowKey(row.product_slug, row.store_id),
        fromCents(row.price_cents),
      ]),
    );
    const { accepted, rejected } = screenRows(rows, previous);

    if (accepted.length > 0) {
      await recordObservations(accepted);
    }

    // One event per run: counts only — no prices, no emails, no secrets
    // (lib/log contract).
    logEvent("info", "ingest.complete", {
      provider: provider.id,
      catalog_products: catalog.products,
      catalog_listings: catalog.listings,
      catalog_offers: catalog.offers,
      products: products.length,
      recorded: accepted.length,
      rejected: rejected.length,
      refusedProducts,
    });

    return NextResponse.json(
      {
        ok: true,
        provider: provider.id,
        catalog,
        products: products.length,
        ingested: accepted.length,
        rejected: rejected.length,
        rejections: rejected,
        refusedProducts,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // Detail goes to the server log, never the response: this is a public
    // endpoint (the response stays opaque on purpose).
    logEvent("error", "ingest.failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "ingestion failed" },
      { status: 500, headers: NO_STORE },
    );
  }
}

export const GET = ingest;
export const POST = ingest;
