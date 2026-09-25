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

/**
 * Whether a provider can answer at all right now.
 *
 * An adapter for a marketplace we are not yet authorized to read ships as
 * "unavailable" with a reason: it exists, it is registered, and it refuses
 * loudly — never an empty catalog, which would read as "this marketplace has
 * no products", a claim nobody here can make.
 *
 * The error, the guard, and the adapters themselves live in
 * `lib/api/marketplace-adapters.ts`, which is kept free of value imports so
 * scripts/providers-verify.mjs can import it from plain Node.
 */
export type ProviderStatus = "ready" | "unavailable";

export interface MarketplaceProvider {
  /** Stable identifier — also its registry key. */
  readonly id: ProviderId;
  /** Whether readings from this provider are real. Drives the honesty labels. */
  readonly source: DataSource;
  /** Whether it can answer today. Required so nothing is silent about this. */
  readonly status: ProviderStatus;
  /** Required by "unavailable" providers; why we cannot read them yet. */
  readonly unavailableReason?: string;

  /** Every product known to the provider (static params, catalog enumeration). */
  listProducts(): Promise<Product[]>;

  /** Provider-side text search. Facet filters and sorting are applied downstream. */
  searchProducts(query: string): Promise<Product[]>;

  /** A single product by slug, or null when it does not exist. */
  getProduct(slug: string): Promise<Product | null>;

  /** Products related to the given one. */
  getRelatedProducts(product: Product, limit?: number): Promise<Product[]>;
}
