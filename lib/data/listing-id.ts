/**
 * The marketplace's listing id, derived from a listing URL — the one rule
 * migrations 0007/0011 define in SQL and `offers.external_id` /
 * `marketplace_listings.external_id` store.
 *
 * Lives here rather than in lib/db so both sides that need it can share it
 * without dragging in database imports: the catalog writes (lib/db) and the
 * ingestion contract (lib/data/ingest.ts), which stays free of database
 * imports so verification scripts can exercise it in plain Node.
 *
 * Mirrors the SQL rule: strip scheme+host; an empty path (a store-homepage
 * link) falls back to the deterministic `slug:store` surrogate.
 */
export function deriveExternalId(url: string, slug: string, storeId: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/i, "");
  return path === "" ? `${slug}:${storeId}` : path;
}
