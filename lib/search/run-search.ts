import type { Product, SearchFilters, SearchSort } from "@/lib/types";
import { getActiveProvider } from "@/lib/api/registry";
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  filterAndSortProducts,
  isProductUrl,
} from "@/lib/data/search-core";
import { resolveListingUrl } from "@/lib/matching";

/**
 * The single search pipeline.
 *
 * The server-rendered page and `/api/search` both call this, so the first
 * paint and every later filter change run identical logic — there is no way
 * for the two to disagree about what a query means.
 *
 * Two things happen here that used to happen only in the browser:
 *  1. pasted marketplace links are resolved through the Phase 5 matcher
 *     instead of a hard-coded guess
 *  2. filters and sort are applied server-side, so a future live catalog
 *     never has to ship its full result set to the client
 */

export { DEFAULT_FILTERS, DEFAULT_SORT };

export type SearchRequest = {
  q: string;
  filters?: SearchFilters;
  sort?: SearchSort;
};

export type SearchOutcome = {
  results: Product[];
  /** User-facing explanation of how the query was interpreted, if any. */
  note: string | null;
};

export async function runSearch(request: SearchRequest): Promise<SearchOutcome> {
  const { q, filters = DEFAULT_FILTERS, sort = DEFAULT_SORT } = request;
  const provider = getActiveProvider();

  if (isProductUrl(q)) {
    const catalog = await provider.listProducts();
    const resolution = resolveListingUrl(q, catalog);

    const resolved =
      resolution.result.status === "match"
        ? [resolution.result.product]
        : resolution.result.status === "ambiguous"
          ? resolution.result.candidates
          : [];

    // The query text has already been consumed by the resolver, so filters
    // run against an empty query rather than against the URL string itself.
    return {
      results: filterAndSortProducts(resolved, "", filters, sort),
      note: resolution.note,
    };
  }

  const matches = await provider.searchProducts(q);
  return { results: filterAndSortProducts(matches, q, filters, sort), note: null };
}
