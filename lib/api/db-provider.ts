import "server-only";

import type { Product } from "@/lib/types";
import type { MarketplaceProvider } from "@/lib/api/provider";
import { query } from "@/lib/db";
import {
  assembleProduct,
  CATALOG_SEARCH_SQL,
  LIST_CATALOG_PRODUCTS_SQL,
  OFFERS_FOR_SLUGS_SQL,
  OFFERS_FOR_SLUG_SQL,
  PRODUCT_BY_SLUG_SQL,
  RELATED_PRODUCTS_SQL,
  type CatalogOfferRow,
  type CatalogProductRow,
  type CatalogSeriesRow,
} from "@/lib/db/catalog-queries";
import {
  PRODUCT_SERIES_FOR_SLUGS_SQL,
  PRODUCT_SERIES_SQL,
} from "@/lib/db/observation-queries";
import { filterAndSortProducts } from "@/lib/data/search-core";

/**
 * The database-backed provider — backend §19's "production reads come from
 * the database" made concrete. It is the read model over `products`,
 * `offers`, `marketplace_listings` and `price_observations`: marketplace
 * adapters write there, this serves from there, and no page ever talks to
 * Postgres directly.
 *
 * Deliberately plain: no server-only in its dependencies' import graph
 * beyond `lib/db`, so the same assembly SQL that scripts/catalog-verify
 * runs against a real database is the assembly this provider runs in the
 * app — one definition, not two.
 *
 * Its `source` is "demo" only to keep ingest's refusal honest: the database
 * is the storage side and must never be selected as a *source* of readings
 * to ingest (providerRefusal refuses it by id before the source matters).
 * Per-offer `source` — demo | live — carries the real provenance labels.
 */
export const dbProvider: MarketplaceProvider = {
  id: "db",
  source: "demo",
  status: "ready",

  async listProducts(): Promise<Product[]> {
    const rows = await query<CatalogProductRow>(LIST_CATALOG_PRODUCTS_SQL);
    const products = await withRelatedData(rows);
    // An empty production catalog is a configuration error, not "no products
    // exist" — the same reasoning behind the marketplace adapters' loud
    // refusals (§17: never let a failure read as an empty store).
    if (products.length === 0) {
      throw new Error(
        "The database catalog is empty — run `npm run catalog:seed` before serving from DATA_PROVIDER=db.",
      );
    }
    return products;
  },

  /** SQL prefilter (§21) → the same in-process ranking the demo catalog uses. */
  async searchProducts(search: string): Promise<Product[]> {
    const words = search.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    // $1: substring patterns for the text fields. % / _ are escaped so a query
    // for "50%" is a literal, not a wildcard.
    const patterns = words.map((word) => `%${word.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
    // $2: the raw words, for exact identifier equality (SKU / model / GTIN /
    // marketplace listing id).
    const rows = await query<CatalogProductRow>(CATALOG_SEARCH_SQL, [patterns, words]);
    const candidates = await withRelatedData(rows);
    return filterAndSortProducts(candidates, search, {}, "lowest-price");
  },

  async getProduct(slug: string): Promise<Product | null> {
    const [row] = await query<CatalogProductRow>(PRODUCT_BY_SLUG_SQL, [slug]);
    if (!row) return null;

    const [offerRows, seriesRows] = await Promise.all([
      query<CatalogOfferRow>(OFFERS_FOR_SLUG_SQL, [slug]),
      query<CatalogSeriesRow>(PRODUCT_SERIES_SQL, [slug]),
    ]);
    return assembleProduct(row, offerRows, seriesRows);
  },

  async getRelatedProducts(product: Product, limit = 4): Promise<Product[]> {
    const rows = await query<CatalogProductRow>(RELATED_PRODUCTS_SQL, [
      product.slug,
      product.category,
      product.brand,
      limit,
    ]);
    return withRelatedData(rows);
  },
};

/** Bulk-load offers + series for a page of products (no N+1, §34). */
async function withRelatedData(rows: CatalogProductRow[]): Promise<Product[]> {
  if (rows.length === 0) return [];
  const slugs = rows.map((row) => row.slug);

  const [offerRows, seriesRows] = await Promise.all([
    query<CatalogOfferRow>(OFFERS_FOR_SLUGS_SQL, [slugs]),
    query<CatalogSeriesRow>(PRODUCT_SERIES_FOR_SLUGS_SQL, [slugs]),
  ]);

  const offersBy = groupBy(offerRows, (row) => row.product_slug);
  const seriesBy = groupBy(seriesRows, (row) => row.product_slug ?? "");

  // Preserve SQL order (name-sorted) while attaching each product's data.
  return rows.map((row) =>
    assembleProduct(row, offersBy.get(row.slug) ?? [], seriesBy.get(row.slug) ?? []),
  );
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket) bucket.push(row);
    else grouped.set(key(row), [row]);
  }
  return grouped;
}
