import type { DataSource, Product } from "@/lib/types";

/**
 * The ingestion contract — how a provider's readings become rows in
 * `price_observations`.
 *
 * Two rules, both aimed at the same failure: a price history that never
 * happened.
 *
 * 1. Only a provider that is authorized to report real prices may have its
 *    readings recorded at all. The sample catalog is generated from a seeded
 *    RNG, so writing its `updatedAt` stamps into an append-only history would
 *    manufacture observations nobody ever made — labelled or not, the dates
 *    themselves would be fiction. Refusing the whole batch is the only honest
 *    answer.
 * 2. Once authorized, each row keeps the source its own offer claims. A live
 *    provider can still carry an offer it has not verified; that row is written
 *    as "demo" and `getProductSeries` taints the line via `bool_and`, so a
 *    single unverified reading drags the whole series down to "sample". The
 *    system only ever errs in the understated direction.
 *
 * Deliberately depends on nothing but types, so it can be exercised by a
 * verification script as well as by a future ingestion job.
 */

/** One row, ready for `recordObservations()`. */
export type IngestRow = {
  productSlug: string;
  storeId: string;
  /** Price in pesos, matching the rest of the app. */
  price: number;
  /** ISO timestamp of when the price was actually observed. */
  observedAt: string;
  availability: "in_stock" | "out_of_stock";
  source: DataSource;
};

export type IngestPlan =
  | { authorized: true; providerId: string; providerSource: DataSource; rows: IngestRow[] }
  | { authorized: false; providerId: string; reason: string };

/**
 * The provider facts ingestion depends on. Kept structural so this module does
 * not have to import the provider registry, and so a caller can pass anything
 * that can honestly answer for its own readings.
 */
export type IngestProvider = {
  readonly id: string;
  readonly source: DataSource;
};

export function planIngestion(
  provider: IngestProvider,
  product: Product,
): IngestPlan {
  if (provider.source !== "live") {
    return {
      authorized: false,
      providerId: provider.id,
      reason:
        `Provider "${provider.id}" is not authorized to report real prices ` +
        `(source: "${provider.source}"). Its readings are generated, so ` +
        `recording them would create a price history that never happened. ` +
        `Refused — nothing was written.`,
    };
  }

  const rows: IngestRow[] = product.offers.map((offer) => ({
    productSlug: product.slug,
    storeId: offer.storeId,
    price: offer.price,
    observedAt: offer.updatedAt,
    availability: offer.inStock ? "in_stock" : "out_of_stock",
    source: offer.source,
  }));

  const unreadable = rows.find((row) => Number.isNaN(Date.parse(row.observedAt)));
  if (unreadable) {
    return {
      authorized: false,
      providerId: provider.id,
      reason:
        `Offer ${unreadable.storeId} on ${unreadable.productSlug} carries an ` +
        `unreadable observation time ("${unreadable.observedAt}"). Refusing the ` +
        `batch rather than guessing when it was seen — nothing was written.`,
    };
  }

  return {
    authorized: true,
    providerId: provider.id,
    providerSource: provider.source,
    rows,
  };
}
