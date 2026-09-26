-- Live Data Readiness pass, §3 — price observation LISTING IDENTITY.
--
-- price_observations identified a reading by (product_slug, store_id, source,
-- observed_at) (0008). That is one slot per marketplace per product, so two
-- sellers listing the same product — Shopee seller A at ₱40,000, seller B at
-- ₱38,000, observed at the same instant — collided, and ON CONFLICT DO
-- NOTHING silently kept one row and dropped the other. For a comparison
-- engine that is data loss on exactly the rows the product page compares.
--
-- The fix reuses the marketplace's own listing identity rather than inventing
-- a second one: `listing_external_id` carries the same URL-derived external id
-- that offers.external_id and marketplace_listings.external_id carry
-- (migrations 0007/0011, lib/db/catalog-queries.ts deriveExternalId), so an
-- observation lands on the same key its offer was written under.
--
-- Existing rows keep '' — unattributed. They were recorded before listing
-- identity existed and cannot be mapped to a seller after the fact; their
-- honest scope is still product+store, which is all they ever claimed.
-- Nothing is deleted and nothing is guessed.

ALTER TABLE price_observations
  ADD COLUMN listing_external_id text NOT NULL DEFAULT '';

-- Same index name as 0008 so audits that track this index keep tracking it.
-- The key now includes the listing, so distinct sellers at one instant no
-- longer collide, while a retry of the same reading is still idempotent.
DROP INDEX price_observations_idempotency_idx;

CREATE UNIQUE INDEX price_observations_idempotency_idx
  ON price_observations (product_slug, store_id, listing_external_id, source, observed_at);
