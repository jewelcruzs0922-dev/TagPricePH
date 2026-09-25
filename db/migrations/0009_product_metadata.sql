-- Backend §19: full demo-catalog fidelity in the database, so a build served
-- from the DB catalog (DATA_PROVIDER=db) renders the same product pages the
-- static seed does — tagline, specs, keywords, ratings, and the was-price
-- signals all live on the row instead of being reachable only from
-- lib/data/products.ts.
--
-- Ratings/review counts stay demo provenance: the UI hides them whenever the
-- served data is sample (product page gates on isDemoData), and `source` on
-- the row keeps them auditable. Money stays integer centavos.

ALTER TABLE products
  ADD COLUMN tagline              text,
  ADD COLUMN keywords             text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN specs                text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN rating               numeric(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  ADD COLUMN review_count         integer CHECK (review_count IS NULL OR review_count >= 0),
  ADD COLUMN previous_price_cents integer CHECK (previous_price_cents IS NULL OR previous_price_cents > 0),
  ADD COLUMN drop_percent         integer CHECK (drop_percent IS NULL OR (drop_percent >= 0 AND drop_percent <= 100));
