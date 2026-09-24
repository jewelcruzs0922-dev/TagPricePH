import type { DataSource, Product } from "@/lib/types";

/**
 * The seam between the app and whatever actually produces marketplace data.
 *
 * Pages read through this instead of `lib/data/*`, so swapping the sample
 * catalog for a live feed means registering one implementation and flipping a
 * flag — no page edits.
 *
 * Deliberately limited to product *delivery*. Observations, freshness, windows
 * and pricing math are pure derivations from a `Product` (lib/data/observations.ts,
 * lib/pricing), so they behave identically regardless of who produced it.
 */
export type ProviderId = "demo" | (string & {});

export interface MarketplaceProvider {
  /** Stable identifier — also its registry key. */
  readonly id: ProviderId;
  /** Whether readings from this provider are real. Drives the honesty labels. */
  readonly source: DataSource;

  /** Every product known to the provider (static params, catalog enumeration). */
  listProducts(): Promise<Product[]>;

  /** Provider-side text search. Facet filters and sorting are applied downstream. */
  searchProducts(query: string): Promise<Product[]>;

  /** A single product by slug, or null when it does not exist. */
  getProduct(slug: string): Promise<Product | null>;

  /** Products related to the given one. */
  getRelatedProducts(product: Product, limit?: number): Promise<Product[]>;
}
