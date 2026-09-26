import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimitResponse } from "@/lib/api/request-guard";
import { parsePage, parseSearchParams } from "@/lib/data/search-url";
import { toClientProducts } from "@/lib/data/search-core";
import { runSearch, SEARCH_PAGE_SIZE } from "@/lib/search/run-search";
import { resolveBuyTimings } from "@/lib/db/observations";
import { logEvent } from "@/lib/log";
import { consumeRateLimit, type RateLimitState } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Server-side search.
 *
 * Every filter and sort change lands here rather than filtering a copy of the
 * result set in the browser, which is what lets the demo catalog be swapped
 * for a live one without changing the client.
 *
 * `timings` comes back with the results so the cards agree with what the
 * product page would say: both derive the verdict from the recorded series
 * where one exists, in a single batched query rather than one per card.
 *
 * Encoding and decoding both live in `lib/data/search-url.ts` so the two sides
 * cannot drift apart. A per-IP budget bounds the unauthenticated work each
 * caller can ask for; the query itself is length-capped in the parser.
 */
const SEARCH_LIMIT = { limit: 120, windowMs: 60_000 };
const searchBuckets: RateLimitState = new Map();

export async function GET(request: NextRequest) {
  const limited = rateLimitResponse(
    consumeRateLimit(searchBuckets, `search:${clientIp(request)}`, SEARCH_LIMIT),
    "too many requests",
  );
  if (limited) return limited;

  try {
    const { q, filters, sort } = parseSearchParams(request.nextUrl.searchParams);
    const page = parsePage(request.nextUrl.searchParams);
    const { results, note } = await runSearch({ q, filters, sort });

    // One window per request: the total tells the client how much more there
    // is, so nothing beyond it has to reach the browser until it is asked for.
    const start = (page - 1) * SEARCH_PAGE_SIZE;
    const window = results.slice(start, start + SEARCH_PAGE_SIZE);
    const timings = await resolveBuyTimings(window);

    return NextResponse.json({
      results: toClientProducts(window),
      note,
      timings,
      total: results.length,
      page,
      hasMore: start + window.length < results.length,
    });
  } catch (error) {
    // Fixed body for the caller; the exception detail goes to the log drain.
    logEvent("error", "search.failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "search failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
