-- Phase 3: core data schema for observations, alerts, and outbound clicks.
--
-- Money is stored as integer centavos (never floats) so amounts stay exact.
-- lib/db/money.ts is the single conversion point to/from the app's peso numbers.
--
-- product_slug / store_id are plain text with no foreign keys: products are
-- still curated in TypeScript (lib/data/products.ts) and stores are static
-- metadata (lib/data/stores.ts). Neither is a table yet.

CREATE TABLE price_observations (
  id            bigserial   PRIMARY KEY,
  product_slug  text        NOT NULL,
  store_id      text        NOT NULL,
  price_cents   integer     NOT NULL CHECK (price_cents > 0),
  availability  text        NOT NULL DEFAULT 'in_stock'
                CHECK (availability IN ('in_stock', 'out_of_stock')),
  source        text        NOT NULL CHECK (source IN ('demo', 'live')),
  observed_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- "what does this offer cost over time" — the price-history read path.
CREATE INDEX price_observations_offer_idx
  ON price_observations (product_slug, store_id, observed_at DESC);

-- "what changed recently" — price drops and freshness sweeps.
CREATE INDEX price_observations_recent_idx
  ON price_observations (observed_at DESC);

-- keeps demo readings separable from live ones as both accumulate.
CREATE INDEX price_observations_source_idx
  ON price_observations (source, observed_at DESC);

CREATE TABLE price_alerts (
  id                 bigserial   PRIMARY KEY,
  product_slug       text        NOT NULL,
  target_price_cents integer     NOT NULL CHECK (target_price_cents > 0),
  email              text        NOT NULL CHECK (position('@' in email) > 1),
  status             text        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'triggered', 'cancelled')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  triggered_at       timestamptz
);

CREATE INDEX price_alerts_lookup_idx
  ON price_alerts (product_slug, status);

CREATE INDEX price_alerts_email_idx
  ON price_alerts (email);

-- One row per outbound click through /go/[store]/[product].
CREATE TABLE click_events (
  id            bigserial   PRIMARY KEY,
  product_slug  text        NOT NULL,
  store_id      text        NOT NULL,
  placement     text        NOT NULL DEFAULT 'unknown',
  destination   text        NOT NULL,
  referrer      text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX click_events_recent_idx
  ON click_events (created_at DESC);

CREATE INDEX click_events_product_idx
  ON click_events (product_slug, store_id, created_at DESC);
