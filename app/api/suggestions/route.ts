import { NextRequest, NextResponse } from "next/server";
import { getSuggestions } from "@/lib/data/search";
import { toClientProducts } from "@/lib/data/search-core";

export const dynamic = "force-dynamic";

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
 * A failed request returns an empty list with the error status rather than a
 * shape the caller has to defend against; the bar treats both as "no
 * suggestions" and keeps working.
 */
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q") ?? "";
    return NextResponse.json(toClientProducts(getSuggestions(q)));
  } catch {
    return NextResponse.json(
      { error: "suggestions failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
