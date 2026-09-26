import type { DataSource, Product } from "@/lib/types";
import { deriveExternalId } from "./listing-id.ts";

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
  /**
   * The listing this reading came from — the marketplace's own external id
   * (lib/data/listing-id.ts), "" when the provider reports no listing. Two
   * sellers of one product on one marketplace are two different identities, so
   * a reading is never just product+store (Live Data Readiness §3).
   */
  listingExternalId: string;
  /** Price in pesos, matching the rest of the app. */
  price: number;
  /** ISO timestamp of when the price was actually observed. */
  observedAt: string;
  availability: "in_stock" | "out_of_stock";
  source: DataSource;
  /** Who reported it — provenance, carried through to price_observations. */
  providerId: string;
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

/**
 * Why this provider may not write, or null when it may.
 *
 * Kept separate from `planIngestion` so an ingestion run can refuse the whole
 * job up front — one message for the run instead of one per product — while
 * still using exactly the same words.
 */
export function providerRefusal(provider: IngestProvider): string | null {
  // The database is the storage side of ingestion, never a source: selecting
  // DATA_PROVIDER=db would otherwise read its own rows back and re-record
  // them as fresh observations on every run. Refused by id, ahead of the
  // source check, with words that describe what it actually is.
  if (provider.id === "db") {
    return (
      `Provider "${provider.id}" is the database read model — it serves what ` +
      `other providers wrote and is never a source of new readings. ` +
      `Refused — nothing was written.`
    );
  }
  if (provider.source === "live") return null;
  return (
    `Provider "${provider.id}" is not authorized to report real prices ` +
    `(source: "${provider.source}"). Its readings are generated, so ` +
    `recording them would create a price history that never happened. ` +
    `Refused — nothing was written.`
  );
}

export function planIngestion(
  provider: IngestProvider,
  product: Product,
): IngestPlan {
  const refusal = providerRefusal(provider);
  if (refusal) {
    return { authorized: false, providerId: provider.id, reason: refusal };
  }

  const rows: IngestRow[] = product.offers.map((offer) => ({
    productSlug: product.slug,
    storeId: offer.storeId,
    listingExternalId: deriveExternalId(offer.url, product.slug, offer.storeId),
    price: offer.price,
    observedAt: offer.updatedAt,
    availability: offer.inStock ? "in_stock" : "out_of_stock",
    source: offer.source,
    providerId: provider.id,
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

/**
 * Phase 18's row-level screening: the impossible readings are refused before
 * anything is written, while aggressive-but-real sales pass.
 *
 * The 85% threshold is chosen to catch the errors that actually happen —
 * dropped zeros, decimal slips, unconverted currencies (all ≈10× moves) —
 * without ever blocking a legitimate deep discount. A row that fails is
 * reported with its reason instead of silently vanishing: the batch records
 * what was accepted, and the caller learns exactly what was refused and why.
 *
 * Pure by design (like planIngestion): the caller supplies the last recorded
 * price per listing — keyed by `rowKey`, which is product+store+listing — so
 * this module never touches the database and the verification script exercises
 * exactly the code the route runs. Scoping the previous price to the same
 * listing is what stops Seller B's first reading from being judged against
 * Seller A's last one (Live Data Readiness §4): an unseen seller starts with
 * no baseline instead of someone else's.
 */
export const MAX_PLAUSIBLE_CHANGE = 0.85;

export type RejectedIngestRow = {
  productSlug: string;
  storeId: string;
  price: number;
  observedAt: string;
  reason: string;
};

/**
 * One logical listing: product + store + that listing's external id. The
 * separator matches the SQL key lib/db/observation-queries.ts builds, so the
 * map keys a verification script passes and the rows the database answers
 * are literally the same strings.
 */
export function rowKey(
  productSlug: string,
  storeId: string,
  listingExternalId: string,
): string {
  return `${productSlug}::${storeId}::${listingExternalId}`;
}

export function screenRows(
  rows: IngestRow[],
  previousPrices: ReadonlyMap<string, number>,
  now: number = Date.now(),
): { accepted: IngestRow[]; rejected: RejectedIngestRow[] } {
  const accepted: IngestRow[] = [];
  const rejected: RejectedIngestRow[] = [];
  const seenInBatch = new Set<string>();

  for (const row of rows) {
    const reject = (reason: string) =>
      rejected.push({
        productSlug: row.productSlug,
        storeId: row.storeId,
        price: row.price,
        observedAt: row.observedAt,
        reason,
      });

    if (!Number.isFinite(row.price) || row.price <= 0) {
      reject(`price ${row.price} is not a positive amount`);
      continue;
    }

    if (Date.parse(row.observedAt) > now + 60 * 60 * 1000) {
      reject(`observation time ${row.observedAt} is in the future`);
      continue;
    }

    const occurrence = `${rowKey(row.productSlug, row.storeId, row.listingExternalId)}::${row.observedAt}`;
    if (seenInBatch.has(occurrence)) {
      reject(`duplicate of an earlier row for this offer at ${row.observedAt}`);
      continue;
    }
    seenInBatch.add(occurrence);

    const previous = previousPrices.get(
      rowKey(row.productSlug, row.storeId, row.listingExternalId),
    );
    if (previous !== undefined && previous > 0) {
      const change = Math.abs(row.price - previous) / previous;
      if (change > MAX_PLAUSIBLE_CHANGE) {
        const direction = row.price > previous ? "up" : "down";
        const percent = Math.round(change * 100);
        reject(
          `price moved ${direction} ${percent}% from the last recorded ` +
            `observation (${previous} → ${row.price}) — beyond the ` +
            `${Math.round(MAX_PLAUSIBLE_CHANGE * 100)}% plausibility limit`,
        );
        continue;
      }
    }

    accepted.push(row);
  }

  return { accepted, rejected };
}
