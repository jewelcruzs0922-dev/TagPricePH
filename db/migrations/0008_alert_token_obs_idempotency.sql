-- Backend §25 + §27: alert authorization, and observation idempotency.
--
-- §25 — an email alone must never authorize reading or cancelling alerts.
-- Each email gains one opaque access token (24 random bytes, hex). The token
-- is minted on the alert's first creation, returned exactly once to its
-- creator, and required for every later read/modify — knowing an address
-- grants nothing. The column is nullable at the type level only so this
-- migration can add it and backfill in one transaction; the application
-- treats NULL as "no access" (fail closed). Existing rows get a token nobody
-- holds — they are pre-release test rows, so locking them out is correct.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE price_alerts ADD COLUMN access_token text;
UPDATE price_alerts SET access_token = encode(gen_random_bytes(24), 'hex')
WHERE access_token IS NULL;

-- "same product, same store, same source, same instant" is one observation,
-- whoever retries it — the DB constraint behind §27's retry-safety, so a
-- repeated sync job cannot pile up duplicates even if in-process screening
-- (lib/data/ingest.ts rowKey) is bypassed.
DELETE FROM price_observations a
USING price_observations b
WHERE a.id > b.id
  AND a.product_slug = b.product_slug
  AND a.store_id = b.store_id
  AND a.source = b.source
  AND a.observed_at = b.observed_at;

CREATE UNIQUE INDEX price_observations_idempotency_idx
  ON price_observations (product_slug, store_id, source, observed_at);

CREATE INDEX price_alerts_token_idx ON price_alerts (email, access_token);
