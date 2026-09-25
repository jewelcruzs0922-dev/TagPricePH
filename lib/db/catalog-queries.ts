/**
 * SQL and pure row→model assembly for the catalog tables (0006/0007/0009),
 * kept free of runtime imports so `scripts/seed.mjs` and
 * `scripts/catalog-verify.mjs` can load this module directly — the same
 * contract `observation-queries.ts` has: one definition of these statements,
 * never two copies that drift. `import type` lines are erased by Node's type
 * stripping, so this file loads in plain Node too.
 */
import type { DataSource, Product, StoreOffer } from "@/lib/types";
import { fromCents, toCents } from "./money.ts";

/* --------------------------------- writes -------------------------------- */

/**
 * Multi-row upsert builders. Catalog syncs move hundreds of rows per run and
 * every statement is a network round trip, so writes are batched — one
 * statement per entity type per chunk, never one per row. Placeholders run
 * $1..$n continuously across tuples; callers chunk with `chunkRows` to stay
 * under Postgres' 65,535-parameter cap (§34 growth: 10k products × 14 columns
 * would otherwise be one illegal statement).
 */
function tuplePlaceholders(columns: number, rows: number): string {
  const tuples: string[] = [];
  for (let row = 0; row < rows; row++) {
    const start = row * columns;
    const slots = Array.from({ length: columns }, (_, c) => `$${start + c + 1}`);
    tuples.push(`(${slots.join(", ")})`);
  }
  return tuples.join(", ");
}

export function chunkRows<T>(rows: T[], size = 1500): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

/** 14 columns per row: see UPSERT parameter order in seed/ingest callers. */
export function upsertProductsSql(rowCount: number): string {
  return `
    INSERT INTO products
      (slug, name, brand, category_slug, sku, image, source,
       tagline, keywords, specs, rating, review_count,
       previous_price_cents, drop_percent)
    VALUES ${tuplePlaceholders(14, rowCount)}
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      brand = EXCLUDED.brand,
      category_slug = EXCLUDED.category_slug,
      sku = EXCLUDED.sku,
      image = EXCLUDED.image,
      source = EXCLUDED.source,
      tagline = EXCLUDED.tagline,
      keywords = EXCLUDED.keywords,
      specs = EXCLUDED.specs,
      rating = EXCLUDED.rating,
      review_count = EXCLUDED.review_count,
      previous_price_cents = EXCLUDED.previous_price_cents,
      drop_percent = EXCLUDED.drop_percent,
      updated_at = now()
  `;
}

export function upsertStoresSql(rowCount: number): string {
  return `
    INSERT INTO stores (id, name)
    VALUES ${tuplePlaceholders(2, rowCount)}
    ON CONFLICT (id) DO NOTHING
  `;
}

/**
 * One listing per store page. `external_id` is the marketplace's own id when
 * the URL carries one, else the deterministic `slug:store` surrogate — the
 * same derivation rule db/migrations/0007 uses, kept identical on purpose.
 * 9 columns per row.
 */
export function upsertListingsSql(rowCount: number): string {
  return `
    INSERT INTO marketplace_listings
      (store_id, external_id, product_slug, title, product_url, seller_name,
       source, status, last_seen_at)
    VALUES ${tuplePlaceholders(9, rowCount)}
    ON CONFLICT (store_id, external_id) DO UPDATE SET
      product_slug = EXCLUDED.product_slug,
      title = EXCLUDED.title,
      product_url = EXCLUDED.product_url,
      seller_name = EXCLUDED.seller_name,
      source = EXCLUDED.source,
      status = EXCLUDED.status,
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = now()
  `;
}

/** 14 columns per row (currency is a real parameter, always 'PHP'). */
export function upsertOffersSql(rowCount: number): string {
  return `
    INSERT INTO offers
      (product_slug, store_id, price_cents, original_price_cents, currency,
       availability, seller, url, affiliate_url, condition, source,
       listing_id, last_checked_at, updated_at)
    VALUES ${tuplePlaceholders(14, rowCount)}
    ON CONFLICT (product_slug, store_id) DO UPDATE SET
      price_cents = EXCLUDED.price_cents,
      original_price_cents = EXCLUDED.original_price_cents,
      currency = EXCLUDED.currency,
      availability = EXCLUDED.availability,
      seller = EXCLUDED.seller,
      url = EXCLUDED.url,
      affiliate_url = EXCLUDED.affiliate_url,
      condition = EXCLUDED.condition,
      source = EXCLUDED.source,
      listing_id = EXCLUDED.listing_id,
      last_checked_at = EXCLUDED.last_checked_at,
      updated_at = EXCLUDED.updated_at
  `;
}

/** Resolve (store_id, external_id) pairs → listing ids for offer linking. */
export function listingIdsSql(pairCount: number): string {
  const tuples: string[] = [];
  for (let i = 0; i < pairCount; i++) {
    const a = i * 2 + 1;
    tuples.push(`($${a}, $${a + 1})`);
  }
  return `
    SELECT store_id, external_id, id
      FROM marketplace_listings
     WHERE (store_id, external_id) IN (VALUES ${tuples.join(", ")})
  `;
}

/**
 * Demo-series refresh: the generated history is anchored to "today", so a
 * re-seed replaces its own rows (identified by provider) instead of
 * appending a second, shifted copy beside the first.
 */
export const DELETE_DEMO_SERIES_SQL = `
  DELETE FROM price_observations
  WHERE provider_id = 'demo-seed'
    AND product_slug = ANY($1::text[])
`;

/* ---------------------------------- reads -------------------------------- */

export const LIST_CATALOG_PRODUCTS_SQL = `
  SELECT * FROM products WHERE active ORDER BY slug
`;

export const PRODUCT_BY_SLUG_SQL = `
  SELECT * FROM products WHERE slug = $1 AND active
`;

export const OFFERS_FOR_SLUGS_SQL = `
  SELECT * FROM offers WHERE product_slug = ANY($1::text[]) ORDER BY product_slug, price_cents
`;

export const OFFERS_FOR_SLUG_SQL = `
  SELECT * FROM offers WHERE product_slug = $1 ORDER BY price_cents
`;

/**
 * §21 prefilter: words matched against name/brand/slug/category, bounded at
 * 200 candidates and returning full rows so the in-process ranking
 * (search-core) runs on that set — never on a full-catalog load, and never
 * as the only matcher. User input is escaped so `%`/`_` are literals.
 */
export const CATALOG_SEARCH_SQL = `
  SELECT * FROM products
   WHERE active AND (
     name ILIKE ANY($1::text[])
     OR brand ILIKE ANY($1::text[])
     OR slug ILIKE ANY($1::text[])
     OR category_slug ILIKE ANY($1::text[])
   )
   ORDER BY name
   LIMIT 200
`;

/** Same-category first, then the rest — SQL twin of getRelatedProducts(). */
export const RELATED_PRODUCTS_SQL = `
  SELECT * FROM products
   WHERE active AND slug <> $1
   ORDER BY (category_slug = $2) DESC, (brand = $3) DESC, slug
   LIMIT $4
`;

export const CATALOG_COUNTS_SQL = `
  SELECT (SELECT count(*) FROM products)                    AS products,
         (SELECT count(*) FROM offers)                      AS offers,
         (SELECT count(*) FROM marketplace_listings)        AS listings,
         (SELECT count(*) FROM price_observations
           WHERE provider_id = 'demo-seed')                 AS demo_series,
         (SELECT count(*) FROM price_observations)          AS observations
`;

/* -------------------------------- assembly -------------------------------- */

export type CatalogProductRow = {
  slug: string;
  name: string;
  brand: string;
  category_slug: string;
  sku: string | null;
  image: string;
  tagline: string | null;
  keywords: string[];
  specs: string[];
  rating: string | null; // numeric arrives from pg as a string
  review_count: number | null;
  previous_price_cents: number | null;
  drop_percent: number | null;
};

export type CatalogOfferRow = {
  product_slug: string;
  store_id: string;
  price_cents: number;
  availability: string;
  seller: string | null;
  url: string;
  affiliate_url: string | null;
  condition: string | null;
  source: string;
  last_checked_at: Date | string | null;
  updated_at: Date | string;
};

export type CatalogSeriesRow = {
  product_slug?: string;
  date: string;
  price_cents: number;
};

/**
 * The marketplace's listing id out of a URL, or the deterministic surrogate
 * when the URL carries no path (store-homepage links). Mirrors the SQL rule
 * in migration 0007: strip scheme+host; empty → `slug:store`.
 */
export function deriveExternalId(url: string, slug: string, storeId: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/i, "");
  return path === "" ? `${slug}:${storeId}` : path;
}

/* ------------------------------ row builders ------------------------------ */

/**
 * The parameter tuples behind the batch upserts — shared by `scripts/seed.mjs`
 * and the live ingest sync so both write byte-identical rows (§19: "one
 * definition, never two copies"). Column order here IS the order
 * `upsertProductsSql`/`upsertListingsSql`/`upsertOffersSql` placeholders run
 * in; changing one means changing both.
 *
 * `source` travels as a parameter: the demo seed writes "demo", a live
 * provider writes "live" — provenance is decided by who reported the row,
 * never by this builder.
 */

/** 14 columns — matches upsertProductsSql. */
export function productRow(product: Product, source: DataSource): unknown[] {
  return [
    product.slug,
    product.name,
    product.brand,
    product.category,
    product.sku ?? null,
    product.image,
    source,
    product.tagline ?? null,
    product.keywords ?? [],
    product.specs ?? [],
    product.rating ?? null,
    product.reviewCount ?? null,
    product.previousPrice != null ? toCents(product.previousPrice) : null,
    product.dropPercent ?? null,
  ];
}

/**
 * 9 columns — matches upsertListingsSql. Deduped by (store, external): one
 * URL is one listing, even when many products' offers share that URL (the
 * demo TikTok offers all point at one store page). Keeps ON CONFLICT
 * DO UPDATE from seeing the same key twice inside one statement.
 */
export function listingRowsFor(products: Product[], source: DataSource): unknown[][] {
  const rows: unknown[][] = [];
  const seen = new Set<string>();
  for (const product of products) {
    for (const offer of product.offers) {
      const external = deriveExternalId(offer.url, product.slug, offer.storeId);
      const key = `${offer.storeId}\u0000${external}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push([
        offer.storeId,
        external,
        product.slug,
        product.name,
        offer.url,
        offer.seller ?? null,
        source,
        offer.inStock ? "active" : "inactive",
        offer.updatedAt,
      ]);
    }
  }
  return rows;
}

/** 14 columns — matches upsertOffersSql. Affiliate link: null until an offer
 * carries one; the column exists so live providers can set it (§24). */
export function offerRow(
  product: Product,
  offer: StoreOffer,
  listingId: number | null,
): unknown[] {
  return [
    product.slug,
    offer.storeId,
    toCents(offer.price),
    null,
    "PHP",
    offer.inStock ? "in_stock" : "out_of_stock",
    offer.seller ?? null,
    offer.url,
    null,
    offer.condition ?? null,
    offer.source,
    listingId,
    offer.updatedAt,
    offer.updatedAt,
  ];
}

/**
 * Stores a set of products depends on — [id, id] pairs: ON CONFLICT DO
 * NOTHING keeps a seeded retailer's real name, and a store nobody seeded
 * falls back to id-as-name, exactly like getStore() does for display.
 */
export function storeRowsFor(products: Product[]): [string, string][] {
  const ids = new Set<string>();
  for (const product of products) for (const offer of product.offers) ids.add(offer.storeId);
  return [...ids].map((id) => [id, id]);
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return new Date(value).toISOString();
}

/**
 * Row(s) → the app's Product shape. Money crosses as centavos and converts
 * through lib/db/money; optional fields are omitted when the row has none,
 * so the assembled product is indistinguishable from the static seed's.
 */
export function assembleProduct(
  row: CatalogProductRow,
  offerRows: CatalogOfferRow[],
  seriesRows: CatalogSeriesRow[],
): Product {
  const offers: StoreOffer[] = offerRows.map((offer) => ({
    storeId: offer.store_id,
    price: fromCents(offer.price_cents),
    url: offer.url,
    updatedAt: iso(offer.updated_at) ?? new Date(0).toISOString(),
    inStock: offer.availability === "in_stock",
    source: offer.source as DataSource,
    ...(offer.affiliate_url ? { affiliateUrl: offer.affiliate_url } : {}),
    ...(offer.seller ? { seller: offer.seller } : {}),
    ...(offer.condition
      ? { condition: offer.condition as "bundle" | "different_variant" }
      : {}),
  }));

  return {
    id: row.slug,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    category: row.category_slug,
    ...(row.sku ? { sku: row.sku } : {}),
    ...(row.tagline ? { tagline: row.tagline } : {}),
    ...(row.keywords?.length ? { keywords: row.keywords } : {}),
    image: row.image,
    ...(row.specs?.length ? { specs: row.specs } : {}),
    ...(row.rating !== null ? { rating: Number(row.rating) } : {}),
    ...(row.review_count !== null ? { reviewCount: row.review_count } : {}),
    ...(row.previous_price_cents !== null
      ? { previousPrice: fromCents(row.previous_price_cents) }
      : {}),
    ...(row.drop_percent !== null ? { dropPercent: row.drop_percent } : {}),
    offers,
    priceHistory: seriesRows.map((point) => ({
      date: point.date,
      price: fromCents(point.price_cents),
    })),
  };
}
