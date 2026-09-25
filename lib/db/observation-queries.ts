/**
 * SQL for the observation store, kept free of imports so `scripts/observations-verify.mjs`
 * can load this module directly and run the *same* statements the app runs.
 * There is one definition of these queries, not two copies that drift.
 */

/**
 * Append a batch of observations in one round trip.
 *
 * Column order is positional and must stay aligned with the unnest arrays in
 * lib/db/observations.ts: product, store, price, availability, source, time,
 * provider.
 *
 * ON CONFLICT DO NOTHING is backend §27's retry-safety at the statement
 * level: a re-run of the same batch (same product/store/source/instant, the
 * 0008 unique index) skips the rows it already wrote instead of failing or
 * duplicating them — safe for cron retries, and invisible to callers, which
 * see ingested = rows actually written via rowCount.
 */
export const INSERT_OBSERVATIONS_SQL = `
  INSERT INTO price_observations
    (product_slug, store_id, price_cents, availability, source, observed_at, provider_id)
  SELECT * FROM unnest(
    $1::text[], $2::text[], $3::integer[], $4::text[], $5::text[], $6::timestamptz[], $7::text[]
  )
  ON CONFLICT DO NOTHING
`;

/**
 * One point per calendar day — the lowest price observed across any store that
 * day — plus whether every reading behind that point was live.
 *
 * `all_live` is a bool_and on purpose: a single generated reading taints the
 * day, and the series may only claim "live" if all of it is.
 */
export const PRODUCT_SERIES_SQL = `
  SELECT to_char(date_trunc('day', observed_at), 'YYYY-MM-DD') AS date,
         min(price_cents)                AS price_cents,
         bool_and(source = 'live')       AS all_live
    FROM price_observations
   WHERE product_slug = $1
   GROUP BY 1
   ORDER BY 1 ASC
`;

/**
 * The same aggregation for a whole page of products in one round trip.
 *
 * Lists render dozens of cards at a time; running PRODUCT_SERIES_SQL per card
 * would turn a category page into N queries. Grouping by slug here keeps it a
 * single statement without changing what a point means.
 */
export const PRODUCT_SERIES_FOR_SLUGS_SQL = `
  SELECT product_slug,
         to_char(date_trunc('day', observed_at), 'YYYY-MM-DD') AS date,
         min(price_cents)          AS price_cents,
         bool_and(source = 'live') AS all_live
    FROM price_observations
   WHERE product_slug = ANY($1::text[])
   GROUP BY product_slug, to_char(date_trunc('day', observed_at), 'YYYY-MM-DD')
   ORDER BY product_slug ASC, 2 ASC
`;

/**
 * The last recorded price per (product, store) for a batch of candidate keys —
 * exactly what screenRows() needs to refuse impossible moves at ingestion
 * (Phase 18). One statement for the whole batch, like every other read here.
 */
export const LAST_PRICES_SQL = `
  SELECT DISTINCT ON (product_slug, store_id)
         product_slug, store_id, price_cents
    FROM price_observations
   WHERE (product_slug, store_id) IN (
     SELECT * FROM unnest($1::text[], $2::text[])
   )
   ORDER BY product_slug, store_id, observed_at DESC
`;
