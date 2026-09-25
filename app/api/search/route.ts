import { NextRequest, NextResponse } from "next/server";
import { parseSearchParams } from "@/lib/data/search-url";
import { runSearch } from "@/lib/search/run-search";

export const dynamic = "force-dynamic";

/**
 * Server-side search.
 *
 * Every filter and sort change lands here rather than filtering a copy of the
 * result set in the browser, which is what lets the demo catalog be swapped
 * for a live one without changing the client.
 *
 * Encoding and decoding both live in `lib/data/search-url.ts` so the two sides
 * cannot drift apart.
 */
export async function GET(request: NextRequest) {
  try {
    const { q, filters, sort } = parseSearchParams(request.nextUrl.searchParams);
    const { results, note } = await runSearch({ q, filters, sort });

    return NextResponse.json({ results, note });
  } catch {
    // Deliberately carries no exception detail: this is a public endpoint.
    return NextResponse.json(
      { error: "search failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
