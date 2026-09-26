/**
 * SQL for the observation store, kept free of imports so `scripts/observations-verify.mjs`
 * can load this module directly and run the *same* statements the app runs.
 * There is one definition of these queries, not two copies that drift.
 */

/**
 * Append a batch of observations in one round trip.
 *
 * Column order is positional and must stay aligned with the unnest arrays in
 * lib/db/observations.ts: product, store, listing, price, availability,
 * source, time, provider.
 *
 * ON CONFLICT DO NOTHING is backend §27's retry-safety at the statement
 * level: a re-run of the same batch (same product/store/listing/source/
 * instant, the 0013 unique index) skips the rows it already wrote instead of
 * failing or duplicating them — safe for cron retries, and invisible to
 * callers, which see ingested = rows actually written via rowCount. Because
 * the key now includes the listing, two sellers read at one instant are two
 * rows, not one collision (Live Data Readiness §3).
 */
export const INSERT_OBSERVATIONS_SQL = `
  INSERT INTO price_observations
    (product_slug, store_id, listing_external_id, price_cents, availability, source, observed_at, provider_id)
  SELECT * FROM unnest(
    $1::text[], $2::text[], $3::text[], $4::integer[], $5::text[], $6::text[], $7::timestamptz[], $8::text[]
  )
  ON CONFLICT DO NOTHING
`;

/**
 * One point per calendar day — the lowest price observed across any store that
 * day — plus whether every reading behind that point was live.
 *
 * `all_live` is a bool_and on purpose: a single generated reading taints the
 * day, and the series may only claim "live" if all of it is.
 *
 * `$2` (allow_demo) keeps a LIVE product from reading the seed catalog's
 * generated rows out of its own history (Live Data Readiness §5): demo rows
 * still answer for demo products, but they are never plotted onto a product
 * whose offers all claim to be live. The label was always honest about mixed
 * rows; this stops the rows from being there at all.
 */
export const PRODUCT_SERIES_SQL = `
  SELECT to_char(date_trunc('day', observed_at), 'YYYY-MM-DD') AS date,
         min(price_cents)                AS price_cents,
         bool_and(source = 'live')       AS all_live
    FROM price_observations
   WHERE product_slug = $1
     AND (source = 'live' OR $2::boolean = true)
   GROUP BY 1
   ORDER BY 1 ASC
`;

/**
 * The same aggregation for a whole page of products in one round trip.
 *
 * Lists render dozens of cards at a time; running PRODUCT_SERIES_SQL per card
 * would turn a category page into N queries. Grouping by slug here keeps it a
 * single statement without changing what a point means.
 *
 * `$2` is the set of slugs allowed to read demo rows (everything that is not
 * fully live — Live Data Readiness §5). Slugs outside it only ever aggregate
 * `source = 'live'` readings, so one query still serves a mixed list while a
 * live product can never inherit the seed history.
 */
export const PRODUCT_SERIES_FOR_SLUGS_SQL = `
  SELECT product_slug,
         to_char(date_trunc('day', observed_at), 'YYYY-MM-DD') AS date,
         min(price_cents)          AS price_cents,
         bool_and(source = 'live') AS all_live
    FROM price_observations
   WHERE product_slug = ANY($1::text[])
     AND (source = 'live' OR product_slug = ANY($2::text[]))
   GROUP BY product_slug, to_char(date_trunc('day', observed_at), 'YYYY-MM-DD')
   ORDER BY product_slug ASC, 2 ASC
`;

/**
 * The last recorded price per LISTING for a batch of candidate keys — exactly
 * what screenRows() needs to refuse impossible moves at ingestion (Phase 18).
 *
 * Keys are `rowKey()` strings from lib/data/ingest.ts:
 * product::store::listing_external_id. Matching on the composed key (rather
 * than a row of tuples) both fixes the old cross-product pairing of slugs ×
 * stores and scopes every previous price to the listing it belongs to, so a
 * new seller's first reading is never judged against another seller's last
 * (Live Data Readiness §4).
 */
export const LAST_PRICES_SQL = `
  SELECT DISTINCT ON (key) key, price_cents
    FROM (
      SELECT product_slug || '::' || store_id || '::' || listing_external_id AS key,
             price_cents,
             observed_at
        FROM price_observations
       WHERE product_slug || '::' || store_id || '::' || listing_external_id = ANY($1::text[])
    ) AS candidates
   ORDER BY key, observed_at DESC
`;
