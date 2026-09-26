/**
 * What an ingest run revalidates (Final Polish §2), as pure functions so the
 * decision is testable without a server: products are revalidated by slug,
 * global surfaces only when at least one product actually changed, and
 * nothing at all when the run changed nothing. The route (app/api/ingest)
 * executes exactly this plan — 10,000 products with 30 changes cost 30
 * product revalidations plus the four catalog surfaces, never 10,000.
 */
import { rowKey } from "./ingest.ts";
import type { IngestRow } from "./ingest.ts";

export type RevalidationPlan = {
  /** Product slugs whose pages are stale, sorted — the route prefixes `/product/`. */
  products: string[];
  /** True only when at least one product changed: homepage/category/price-drop/sitemap follow. */
  globals: boolean;
};

export function revalidationPlan(affected: ReadonlySet<string>): RevalidationPlan {
  return { products: [...affected].sort(), globals: affected.size > 0 };
}

/**
 * Catalog rows are only half the story: an accepted observation whose price
 * differs from the last recorded one for the SAME listing changes the price
 * history the product page plots, so its product joins the affected set.
 *
 * A first-ever reading counts (the page gains its first live point), an
 * equal price does not — a repeated feed that merely refreshes timestamps is
 * not a material change, which is what keeps invalidation proportional to
 * real price movements instead of feed cadence.
 */
export function mergeObservationChanges(
  affected: Set<string>,
  accepted: readonly IngestRow[],
  previousPrices: ReadonlyMap<string, number>,
): void {
  for (const row of accepted) {
    const previous = previousPrices.get(
      rowKey(row.productSlug, row.storeId, row.listingExternalId),
    );
    if (previous === undefined || previous !== row.price) affected.add(row.productSlug);
  }
}
