import { NextRequest, NextResponse } from "next/server";
import { getActiveProvider } from "@/lib/api/registry";
import { clientIp, rateLimitResponse } from "@/lib/api/request-guard";
import { capQuery } from "@/lib/data/search-url";
import { filterSuggestions, toClientProducts } from "@/lib/data/search-core";
import { logEvent } from "@/lib/log";
import { consumeRateLimit, type RateLimitState } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const SUGGESTIONS_LIMIT = { limit: 120, windowMs: 60_000 };
const suggestionBuckets: RateLimitState = new Map();

/**
 * Typeahead backing for the search bar.
 *
 * The suggestion list used to be filtered in the browser, which meant the
 * whole sample catalog had to ship in the client bundle (a 75 KB chunk, on
 * every page) just to keep keystrokes instant. The catalog stays on the
 * server now: the bar sends the query it already had and receives the same
 * five products the client-side filter used to pick — after
 * `toClientProducts`, so the response carries no price history either.
 *
 * The candidates come from the active provider rather than from the sample
 * seed, so typeahead cannot offer products the site does not actually serve
 * once reads move to the database (§19).
 *
 * A failed request returns an empty list with the error status rather than a
 * shape the caller has to defend against; the bar treats both as "no
 * suggestions" and keeps working.
 */
export async function GET(request: NextRequest) {
  const limited = rateLimitResponse(
    consumeRateLimit(
      suggestionBuckets,
      `suggestions:${clientIp(request)}`,
      SUGGESTIONS_LIMIT,
    ),
    "too many requests",
  );
  if (limited) return limited;

  try {
    const q = capQuery(request.nextUrl.searchParams.get("q") ?? "");
    const matches = await getActiveProvider().searchProducts(q);
    return NextResponse.json(toClientProducts(filterSuggestions(matches, q)));
  } catch (error) {
    logEvent("error", "suggestions.failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "suggestions failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
