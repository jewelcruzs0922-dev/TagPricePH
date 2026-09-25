-- Phase 24: the catalog tables Phase 3's initial schema deliberately
-- deferred ("products are still curated in TypeScript … Neither is a table
-- yet"). This is the persistence layer's catalog side, designed to start
-- small: the tables, keys, and constraints exist now; rows arrive when an
-- explicit catalog sync or a real provider writes them. Until then the app
-- keeps reading the curated seeds (Phase 26 — no speculative migration of
-- demo data into tables nothing reads).
--
-- Phase 24's checklist and where each item lives:
--   Products           → products
--   Product variants   → product_variants (empty by design today: TagPricePH
--                        models each purchasable configuration as its own
--                        product — iPhone 16 128GB ≠ 256GB, Phase 7's
--                        matching contract — so variants are separate rows.
--                        The table exists so a feed that expresses options as
--                        one identity needs no schema change.)
--   Stores             → stores (seeded: the five static retailers)
--   Store offers       → offers
--   Price observations → price_observations (0001)
--   Users/Watchlists   → price_alerts (0001) is the watchlist: Phase 14's
--                        email-identity design means one row IS a user's
--                        watch entry, with no account system to own (Phase 26:
--                        no elaborate authentication). A separate users table
--                        waits until accounts are justified.
--   Outbound clicks    → click_events (0001)
--
-- Money stays integer centavos; source stays demo|live so sample rows can
-- never masquerade as observed ones.

CREATE TABLE stores (
  id          text        PRIMARY KEY,
  name        text        NOT NULL,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO stores (id, name) VALUES
  ('tiktok', 'TikTok Shop'),
  ('lazada', 'Lazada'),
  ('shopee', 'Shopee'),
  ('abensons', 'Abenson'),
  ('sm', 'SM Store')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE products (
  id            bigserial   PRIMARY KEY,
  slug          text        NOT NULL UNIQUE,
  name          text NOT NULL,
  brand         text        NOT NULL,
  category_slug text        NOT NULL,
  sku           text,
  image         text        NOT NULL,
  source        text        NOT NULL DEFAULT 'demo'
                CHECK (source IN ('demo', 'live')),
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX products_category_idx ON products (category_slug);
CREATE INDEX products_brand_idx ON products (brand);

CREATE TABLE product_variants (
  id           bigserial   PRIMARY KEY,
  product_slug text        NOT NULL REFERENCES products(slug) ON DELETE CASCADE,
  name         text        NOT NULL,
  sku          text,
  attributes   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_slug, name)
);

CREATE TABLE offers (
  id                   bigserial    PRIMARY KEY,
  product_slug         text         NOT NULL REFERENCES products(slug) ON DELETE CASCADE,
  store_id             text         NOT NULL REFERENCES stores(id),
  price_cents          integer      NOT NULL CHECK (price_cents > 0),
  original_price_cents integer      CHECK (original_price_cents IS NULL OR original_price_cents > 0),
  currency             text         NOT NULL DEFAULT 'PHP' CHECK (currency = 'PHP'),
  availability         text         NOT NULL DEFAULT 'in_stock'
                       CHECK (availability IN ('in_stock', 'out_of_stock')),
  seller               text,
  url                  text         NOT NULL,
  -- NULL until a marketplace is actually configured — never fabricated
  -- (Phase 9: an invented affiliate parameter is worse than none).
  affiliate_url        text,
  condition            text         CHECK (condition IS NULL OR condition IN ('bundle', 'different_variant')),
  source               text         NOT NULL DEFAULT 'demo'
                       CHECK (source IN ('demo', 'live')),
  last_checked_at      timestamptz,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (product_slug, store_id)
);

CREATE INDEX offers_store_idx ON offers (store_id);
CREATE INDEX offers_checked_idx ON offers (last_checked_at DESC);
