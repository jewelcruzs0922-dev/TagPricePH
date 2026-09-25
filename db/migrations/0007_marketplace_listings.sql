-- Backend §8: the marketplace-specific listing — the missing identity layer
-- between a canonical product and what a store actually offers.
--
-- Product  = "Apple iPhone 16 128GB"          (our canonical identity)
-- Listing  = "Shopee listing #1234567890"     (that store's page for it)
-- Offer    = what it costs right now          (offers, 0006)
--
-- These are not the same entity: the same product has one listing per store,
-- each keyed by the marketplace's own external id when the marketplace gives
-- us one — never by title. `external_id` falls back to a deterministic
-- `product_slug:store_id` surrogate only for rows whose source URL carries no
-- listing identifier (the demo catalog's store-homepage links); a live sync
-- replaces it with the marketplace's real id.
--
-- offers gains a nullable listing_id: existing reads (product_slug + store_id)
-- keep working unchanged — the listing is an added identity layer, not a
-- parallel schema. New syncs write the listing first, then the offer.

CREATE TABLE marketplace_listings (
  id            bigserial   PRIMARY KEY,
  store_id      text        NOT NULL REFERENCES stores(id),
  external_id   text        NOT NULL,
  -- SET NULL, not CASCADE: a listing survives unmapping from our catalog —
  -- the store's page still exists even when we stop tracking the product.
  product_slug  text        REFERENCES products(slug) ON DELETE SET NULL,
  variant_id    bigint      REFERENCES product_variants(id) ON DELETE SET NULL,
  title         text        NOT NULL,
  product_url   text        NOT NULL,
  affiliate_url text,
  seller_name   text,
  seller_id     text,
  source        text        NOT NULL DEFAULT 'demo'
                CHECK (source IN ('demo', 'live')),
  status        text        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive', 'unavailable')),
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, external_id)
);

CREATE INDEX marketplace_listings_product_idx
  ON marketplace_listings (product_slug);
CREATE INDEX marketplace_listings_status_idx
  ON marketplace_listings (status, updated_at DESC);

ALTER TABLE offers ADD COLUMN listing_id bigint REFERENCES marketplace_listings(id) ON DELETE SET NULL;
CREATE INDEX offers_listing_idx ON offers (listing_id);

-- Backfill: one listing per pre-existing offer, derived from its stored URL.
-- Path-less URLs (demo offers link to store homepages) fall back to the
-- deterministic surrogate; ON CONFLICT keeps this re-runnable.
INSERT INTO marketplace_listings (store_id, external_id, product_slug, title, product_url, seller_name, source, status, last_seen_at)
SELECT
  o.store_id,
  COALESCE(
    NULLIF(regexp_replace(o.url, '^https?://[^/]+', ''), ''),
    o.product_slug || ':' || o.store_id
  ) AS external_id,
  o.product_slug,
  COALESCE(p.name, o.product_slug) AS title,
  o.url,
  o.seller,
  o.source,
  CASE WHEN o.availability = 'in_stock' THEN 'active' ELSE 'inactive' END,
  o.last_checked_at
FROM offers o
LEFT JOIN products p ON p.slug = o.product_slug
ON CONFLICT (store_id, external_id) DO NOTHING;

UPDATE offers o
SET listing_id = l.id
FROM marketplace_listings l
WHERE l.store_id = o.store_id
  AND l.product_slug = o.product_slug
  AND o.listing_id IS NULL;
