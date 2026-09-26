import "server-only";

import type { DataSource, Product } from "@/lib/types";
import { withTransaction } from "@/lib/db";
import {
  chunkRows,
  deriveExternalId,
  listingIdsSql,
  listingRowsFor,
  offerRow,
  productRow,
  storeRowsFor,
  upsertListingsSql,
  upsertOffersSql,
  upsertProductsSql,
  upsertStoresSql,
} from "@/lib/db/catalog-queries";
import {
  collectAffectedSlugs,
  listingStateKey,
  listingStateSql,
  offerStateKey,
  offerStateSql,
  PRODUCT_STATE_SQL,
  type ListingStateRow,
  type OfferStateRow,
  type ProductStateRow,
} from "@/lib/db/change-detect";

export type CatalogSyncResult = {
  stores: number;
  products: number;
  listings: number;
  offers: number;
  /**
   * Product slugs whose public data materially changed against the state the
   * database held before this run wrote (Final Polish §2): new/changed
   * products, listings, or offers. Unchanged rows report nothing, so the
   * caller revalidates in proportion to what actually changed.
   */
  affectedSlugs: string[];
};

/** First occurrence wins — duplicate feed records must not split one row. */
function dedupeByKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * Catalog half of a live ingest run (§19): before any observation is
 * recorded, the products/listings/offers the provider reported are upserted
 * into the catalog tables — so the DB read model (DATA_PROVIDER=db) serves
 * exactly what the live run saw, and `offers.listing_id` links every offer
 * to its store page (§8 identity layer).
 *
 * One transaction: a run either fully lands or leaves the catalog untouched;
 * upserts make the next run heal any partial state regardless. Row building
 * comes from the same catalog-queries builders scripts/seed.mjs uses — the
 * seed and a live run cannot disagree about what a row is.
 *
 * Change detection (Final Polish §2) reads the persisted state for every key
 * this run is about to write FIRST, inside the same transaction, and reports
 * the slugs whose rows are new or materially different — so invalidation is
 * proportional to actual changes instead of "everything the feed mentioned".
 *
 * `source` is the *provider's* source (always "live" — the route refuses
 * others before calling this); per-row provenance stays whatever each offer
 * claims, read back by the same labels the seed writes.
 */
export async function syncCatalog(
  products: Product[],
  source: DataSource,
): Promise<CatalogSyncResult> {
  if (products.length === 0) {
    return { stores: 0, products: 0, listings: 0, offers: 0, affectedSlugs: [] };
  }

  const deduped = dedupeByKey(products, (product) => product.slug);
  const storeRows = storeRowsFor(deduped);
  const productTuples = deduped.map((product) => productRow(product, source));
  const listingTuples = listingRowsFor(deduped, source);
  const listingKeys = listingTuples.map(
    (row) => [String(row[0]), String(row[1])] as [string, string],
  );
  const offerKeys = dedupeByKey(
    deduped.flatMap((product) =>
      product.offers.map(
        (offer) =>
          [
            product.slug,
            offer.storeId,
            deriveExternalId(offer.url, product.slug, offer.storeId),
          ] as [string, string, string],
      ),
    ),
    (key) => key.join(" "),
  );

  return withTransaction(async (client) => {
    // State reads happen before any write in this transaction, so the
    // affected set reflects what the database actually held (Final Polish §4:
    // change detection based on persisted state, never assumed).
    const existingProducts = new Map<string, ProductStateRow>();
    for (const chunk of chunkRows([...new Set(deduped.map((p) => p.slug))], 5000)) {
      const { rows } = await client.query<ProductStateRow>(PRODUCT_STATE_SQL, [chunk]);
      for (const row of rows) existingProducts.set(row.slug, row);
    }
    const existingListings = new Map<string, ListingStateRow>();
    for (const chunk of chunkRows(listingKeys, 2000)) {
      const { rows } = await client.query<ListingStateRow>(
        listingStateSql(chunk.length),
        chunk.flat(),
      );
      for (const row of rows) {
        existingListings.set(listingStateKey(row.store_id, row.external_id), row);
      }
    }
    const existingOffers = new Map<string, OfferStateRow>();
    for (const chunk of chunkRows(offerKeys, 2000)) {
      const { rows } = await client.query<OfferStateRow>(offerStateSql(chunk.length), chunk.flat());
      for (const row of rows) {
        existingOffers.set(offerStateKey(row.product_slug, row.store_id, row.external_id), row);
      }
    }

    for (const chunk of chunkRows(storeRows)) {
      await client.query(upsertStoresSql(chunk.length), chunk.flat());
    }
    for (const chunk of chunkRows(productTuples)) {
      await client.query(upsertProductsSql(chunk.length), chunk.flat());
    }
    for (const chunk of chunkRows(listingTuples)) {
      await client.query(upsertListingsSql(chunk.length), chunk.flat());
    }

    // Resolve (store, external) → listing id in one query per chunk so every
    // offer links to its listing. We *just* wrote these rows in this
    // transaction; a miss here means the identity layer is broken, which is
    // exactly the kind of silent drift this layer exists to prevent — fail
    // the run rather than write offers pointing at nothing. Keys are read
    // from the returned rows: an IN-list gives no ordering guarantee.
    const listingIdByKey = new Map<string, number>();
    const pairChunks = chunkRows(listingKeys, 2000);
    for (const chunk of pairChunks) {
      const { rows } = await client.query<{ store_id: string; external_id: string; id: string }>(
        listingIdsSql(chunk.length),
        chunk.flat(),
      );
      for (const row of rows) {
        listingIdByKey.set(listingStateKey(row.store_id, row.external_id), Number(row.id));
      }
    }

    const offerTuples: unknown[][] = [];
    let unlinked = 0;
    for (const product of deduped) {
      for (const offer of product.offers) {
        const external = deriveExternalId(offer.url, product.slug, offer.storeId);
        const listingId = listingIdByKey.get(listingStateKey(offer.storeId, external)) ?? null;
        if (listingId === null) unlinked += 1;
        offerTuples.push(offerRow(product, offer, listingId));
      }
    }
    if (unlinked > 0) {
      throw new Error(
        `catalog sync: ${unlinked} offer(s) could not resolve a listing id ` +
          `after the listings were upserted — refusing to write unlinked rows.`,
      );
    }
    // ON CONFLICT cannot touch the same row twice in one statement, so
    // duplicate feed records for one listing are collapsed first — one
    // listing, one offer row, first record wins.
    const dedupedOfferTuples = dedupeByKey(offerTuples, (tuple) =>
      offerStateKey(String(tuple[0]), String(tuple[1]), String(tuple[14])),
    );
    for (const chunk of chunkRows(dedupedOfferTuples)) {
      await client.query(upsertOffersSql(chunk.length), chunk.flat());
    }

    const affectedSlugs = collectAffectedSlugs({
      productTuples,
      listingTuples,
      offerTuples: dedupedOfferTuples,
      existingProducts,
      existingListings,
      existingOffers,
    });

    return {
      stores: storeRows.length,
      products: productTuples.length,
      listings: listingTuples.length,
      offers: dedupedOfferTuples.length,
      affectedSlugs,
    };
  });
}
