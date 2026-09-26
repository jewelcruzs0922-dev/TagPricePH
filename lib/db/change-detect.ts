/**
 * Change detection for ingest runs (Final Polish §2): what did this run
 * actually change against the state the database held before it wrote?
 *
 * Pure — SQL strings and comparison functions, depending only on the
 * allowlist check in lib/api/affiliate.ts (itself dependency-free) — so
 * `scripts/polish-verify.mjs` exercises exactly the code lib/db/catalog-sync
 * runs, in plain Node. The comparisons mirror the material columns of each
 * upsert's SET clause in catalog-queries.ts and deliberately ignore the
 * runtime stamps (updated_at, last_checked_at, last_seen_at): those move on
 * every touch and are not public content. Affiliate URLs follow the upsert's
 * COALESCE rule — an incoming NULL keeps the stored value, so only a non-NULL
 * approved replacement that differs counts as a change; invalid URLs never
 * reach a write because catalog-queries nulls them before persistence, and
 * they are rejected here again rather than treated as data.
 */

import { isSafeRedirectUrl } from "../api/affiliate.ts";

export const PRODUCT_STATE_SQL = `
  SELECT slug, name, brand, category_slug, sku, image, source, tagline,
         keywords, specs, rating, review_count, previous_price_cents,
         drop_percent, model_number, gtin
    FROM products
   WHERE slug = ANY($1::text[])
`;

/** State read for listings — tuple shape matches listingRowsFor output. */
export function listingStateSql(tupleCount: number): string {
  const tuples: string[] = [];
  for (let i = 0; i < tupleCount; i++) {
    const a = i * 2 + 1;
    tuples.push(`($${a}, $${a + 1})`);
  }
  return `
    SELECT store_id, external_id, product_slug, title, product_url,
           seller_name, source, status, affiliate_url
      FROM marketplace_listings
     WHERE (store_id, external_id) IN (VALUES ${tuples.join(", ")})
  `;
}

/** State read for offers — tuple shape matches offerRow output. */
export function offerStateSql(tupleCount: number): string {
  const tuples: string[] = [];
  for (let i = 0; i < tupleCount; i++) {
    const a = i * 3 + 1;
    tuples.push(`($${a}, $${a + 1}, $${a + 2})`);
  }
  return `
    SELECT product_slug, store_id, external_id, price_cents,
           original_price_cents, currency, availability, seller, url,
           affiliate_url, condition, source, listing_id
      FROM offers
     WHERE (product_slug, store_id, external_id) IN (VALUES ${tuples.join(", ")})
  `;
}

export type ProductStateRow = {
  slug: string;
  name: string;
  brand: string;
  category_slug: string;
  sku: string | null;
  image: string;
  source: string;
  tagline: string | null;
  keywords: string[];
  specs: string[];
  rating: string | null;
  review_count: number | null;
  previous_price_cents: number | null;
  drop_percent: number | null;
  model_number: string | null;
  gtin: string | null;
};

export type ListingStateRow = {
  store_id: string;
  external_id: string;
  product_slug: string;
  title: string;
  product_url: string;
  seller_name: string | null;
  source: string;
  status: string;
  affiliate_url: string | null;
};

export type OfferStateRow = {
  product_slug: string;
  store_id: string;
  external_id: string;
  price_cents: number;
  original_price_cents: number | null;
  currency: string;
  availability: string;
  seller: string | null;
  url: string;
  affiliate_url: string | null;
  condition: string | null;
  source: string;
  listing_id: string | number | null;
};

export function listingStateKey(storeId: string, externalId: string): string {
  return `${storeId} ${externalId}`;
}

export function offerStateKey(
  productSlug: string,
  storeId: string,
  externalId: string,
): string {
  return `${productSlug} ${storeId} ${externalId}`;
}

/** numeric-as-string (pg) and number compare through one lens. */
function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** Same members, order-insensitive — regenerated keyword order is not a change. */
function sameList(a: readonly string[] | null, b: readonly string[] | null): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((value, i) => value === right[i]);
}

/**
 * Incoming NULL (preserve via COALESCE) or an unapproved URL (nulled by
 * persistableAffiliate, or caught here again as defence in depth) is not a
 * change — only a stored-approved replacement that actually differs is.
 */
function affiliateChanged(existing: string | null, incoming: unknown): boolean {
  return (
    typeof incoming === "string" &&
    isSafeRedirectUrl(incoming) &&
    incoming !== existing
  );
}

/** New product, or any material column differs from the persisted row. */
export function productChanged(existing: ProductStateRow | null, incoming: unknown[]): boolean {
  if (!existing) return true;
  return (
    existing.name !== incoming[1] ||
    existing.brand !== incoming[2] ||
    existing.category_slug !== incoming[3] ||
    (existing.sku ?? null) !== (incoming[4] as string | null) ||
    existing.image !== incoming[5] ||
    existing.source !== incoming[6] ||
    (existing.tagline ?? null) !== (incoming[7] as string | null) ||
    !sameList(existing.keywords, incoming[8] as string[]) ||
    !sameList(existing.specs, incoming[9] as string[]) ||
    numOrNull(existing.rating) !== numOrNull(incoming[10]) ||
    numOrNull(existing.review_count) !== numOrNull(incoming[11]) ||
    numOrNull(existing.previous_price_cents) !== numOrNull(incoming[12]) ||
    numOrNull(existing.drop_percent) !== numOrNull(incoming[13]) ||
    (existing.model_number ?? null) !== (incoming[14] as string | null) ||
    (existing.gtin ?? null) !== (incoming[15] as string | null)
  );
}

/** New listing, or any publicly displayed field differs. */
export function listingChanged(existing: ListingStateRow | null, incoming: unknown[]): boolean {
  if (!existing) return true;
  return (
    existing.product_slug !== incoming[2] ||
    existing.title !== incoming[3] ||
    existing.product_url !== incoming[4] ||
    (existing.seller_name ?? null) !== (incoming[5] as string | null) ||
    existing.source !== incoming[6] ||
    existing.status !== incoming[7] ||
    affiliateChanged(existing.affiliate_url, incoming[9])
  );
}

/** New offer, or price/availability/identity/affiliate differs. */
export function offerChanged(existing: OfferStateRow | null, incoming: unknown[]): boolean {
  if (!existing) return true;
  return (
    numOrNull(existing.price_cents) !== numOrNull(incoming[2]) ||
    numOrNull(existing.original_price_cents) !== numOrNull(incoming[3]) ||
    existing.currency !== incoming[4] ||
    existing.availability !== incoming[5] ||
    (existing.seller ?? null) !== (incoming[6] as string | null) ||
    existing.url !== incoming[7] ||
    affiliateChanged(existing.affiliate_url, incoming[8]) ||
    (existing.condition ?? null) !== (incoming[9] as string | null) ||
    existing.source !== incoming[10] ||
    numOrNull(existing.listing_id) !== numOrNull(incoming[11])
  );
}

/**
 * The affected product slugs for one ingest run: every product whose own row,
 * listing, or offer is new or materially different. Deduplicated through a
 * Set and returned sorted, so multiple changes to one product cost exactly
 * one revalidation and callers see a deterministic list.
 */
export function collectAffectedSlugs(input: {
  productTuples: unknown[][];
  listingTuples: unknown[][];
  offerTuples: unknown[][];
  existingProducts: ReadonlyMap<string, ProductStateRow>;
  existingListings: ReadonlyMap<string, ListingStateRow>;
  existingOffers: ReadonlyMap<string, OfferStateRow>;
}): string[] {
  const affected = new Set<string>();
  for (const tuple of input.productTuples) {
    const slug = String(tuple[0]);
    if (productChanged(input.existingProducts.get(slug) ?? null, tuple)) affected.add(slug);
  }
  for (const tuple of input.listingTuples) {
    const key = listingStateKey(String(tuple[0]), String(tuple[1]));
    if (listingChanged(input.existingListings.get(key) ?? null, tuple)) {
      affected.add(String(tuple[2]));
    }
  }
  for (const tuple of input.offerTuples) {
    const key = offerStateKey(String(tuple[0]), String(tuple[1]), String(tuple[14]));
    if (offerChanged(input.existingOffers.get(key) ?? null, tuple)) affected.add(String(tuple[0]));
  }
  return [...affected].sort();
}
