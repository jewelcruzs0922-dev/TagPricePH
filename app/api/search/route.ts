import { NextRequest, NextResponse } from "next/server";
import { parseSearchParams } from "@/lib/data/search-url";
import { runSearch } from "@/lib/search/run-search";
import { resolveBuyTimings } from "@/lib/db/observations";

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
 * cannot drift apart.
 */
export async function GET(request: NextRequest) {
  try {
    const { q, filters, sort } = parseSearchParams(request.nextUrl.searchParams);
    const { results, note } = await runSearch({ q, filters, sort });
    const timings = await resolveBuyTimings(results);

    return NextResponse.json({ results, note, timings });
  } catch {
    // Deliberately carries no exception detail: this is a public endpoint.
    return NextResponse.json(
      { error: "search failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
