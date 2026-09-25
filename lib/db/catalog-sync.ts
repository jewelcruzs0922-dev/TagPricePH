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

export type CatalogSyncResult = {
  stores: number;
  products: number;
  listings: number;
  offers: number;
};

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
 * `source` is the *provider's* source (always "live" — the route refuses
 * others before calling this); per-row provenance stays whatever each offer
 * claims, read back by the same labels the seed writes.
 */
export async function syncCatalog(
  products: Product[],
  source: DataSource,
): Promise<CatalogSyncResult> {
  if (products.length === 0) {
    return { stores: 0, products: 0, listings: 0, offers: 0 };
  }

  const storeRows = storeRowsFor(products);
  const productRows = products.map((product) => productRow(product, source));
  const listingRows = listingRowsFor(products, source);

  return withTransaction(async (client) => {
    for (const chunk of chunkRows(storeRows)) {
      await client.query(upsertStoresSql(chunk.length), chunk.flat());
    }
    for (const chunk of chunkRows(productRows)) {
      await client.query(upsertProductsSql(chunk.length), chunk.flat());
    }
    for (const chunk of chunkRows(listingRows)) {
      await client.query(upsertListingsSql(chunk.length), chunk.flat());
    }

    // Resolve (store, external) → listing id in one query per chunk so every
    // offer links to its listing. We *just* wrote these rows in this
    // transaction; a miss here means the identity layer is broken, which is
    // exactly the kind of silent drift this layer exists to prevent — fail
    // the run rather than write offers pointing at nothing. Keys are read
    // from the returned rows: an IN-list gives no ordering guarantee.
    const pairParams = listingRows.flatMap((row) => [row[0], row[1]]);
    const listingIdByKey = new Map<string, number>();
    const pairChunks = chunkRows(
      Array.from({ length: pairParams.length / 2 }, (_, i) => [
        pairParams[i * 2] as string,
        pairParams[i * 2 + 1] as string,
      ]),
      2000,
    );
    for (const chunk of pairChunks) {
      const { rows } = await client.query<{ store_id: string; external_id: string; id: string }>(
        listingIdsSql(chunk.length),
        chunk.flat(),
      );
      for (const row of rows) {
        listingIdByKey.set(`${row.store_id}\u0000${row.external_id}`, Number(row.id));
      }
    }

    const offerRows: unknown[][] = [];
    let unlinked = 0;
    for (const product of products) {
      for (const offer of product.offers) {
        const external = deriveExternalId(offer.url, product.slug, offer.storeId);
        const listingId =
          listingIdByKey.get(`${offer.storeId}\u0000${external}`) ?? null;
        if (listingId === null) unlinked += 1;
        offerRows.push(offerRow(product, offer, listingId));
      }
    }
    if (unlinked > 0) {
      throw new Error(
        `catalog sync: ${unlinked} offer(s) could not resolve a listing id ` +
          `after the listings were upserted — refusing to write unlinked rows.`,
      );
    }
    for (const chunk of chunkRows(offerRows)) {
      await client.query(upsertOffersSql(chunk.length), chunk.flat());
    }

    return {
      stores: storeRows.length,
      products: productRows.length,
      listings: listingRows.length,
      offers: offerRows.length,
    };
  });
}
