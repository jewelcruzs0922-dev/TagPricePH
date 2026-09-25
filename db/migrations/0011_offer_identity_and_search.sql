-- Backend fix pass.
--
-- FIX 2 — offer identity.
--   offers was UNIQUE (product_slug, store_id): one offer per store per
--   product, which is false on a real marketplace — Shopee alone can list the
--   same canonical product through a dozen sellers, each with its own page and
--   its own price. The natural key is the listing the offer is the current
--   state of: product + store + that listing's external id. That is exactly
--   what marketplace_listings is keyed by (store_id, external_id), so offers
--   carries the same external id and stays idempotent on re-ingest — the same
--   listing upserts, a different listing inserts beside it.
--
--   external_id is derived by the same rule deriveExternalId() applies
--   (path when the URL carries one, `slug:store` surrogate otherwise), so the
--   TypeScript row builder and this backfill never disagree.
--
-- FIX 6 — searchable identity columns.
--   Search already ranks on sku/keywords in process; the SQL prefilter could
--   not see them, so a query for a SKU or a model number came back empty
--   before ranking ever ran. model_number and gtin are added now so a feed
--   that carries them needs no further migration.
--
-- FIX 1 — which listing a click went to.
--   click_events recorded product, store and the resolved destination, but
--   not the listing itself. With many listings per product+store that is the
--   one field that says which page the shopper actually left for.

ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_product_slug_store_id_key;

ALTER TABLE offers ADD COLUMN external_id text;

UPDATE offers
   SET external_id = COALESCE(
         NULLIF(regexp_replace(url, '^https?://[^/]+', ''), ''),
         product_slug || ':' || store_id
       )
 WHERE external_id IS NULL;

ALTER TABLE offers ALTER COLUMN external_id SET NOT NULL;

-- Same column order as the ON CONFLICT target in upsertOffersSql().
CREATE UNIQUE INDEX offers_identity_idx
  ON offers (product_slug, store_id, external_id);

ALTER TABLE products
  ADD COLUMN model_number text,
  ADD COLUMN gtin         text;

CREATE INDEX products_sku_idx          ON products (sku);
CREATE INDEX products_model_number_idx ON products (model_number);
CREATE INDEX products_gtin_idx         ON products (gtin);

-- SET NULL, not CASCADE: a click row is a historical fact even after we stop
-- tracking the listing it points at.
ALTER TABLE click_events
  ADD COLUMN listing_id bigint REFERENCES marketplace_listings(id) ON DELETE SET NULL;

CREATE INDEX click_events_listing_idx ON click_events (listing_id);
