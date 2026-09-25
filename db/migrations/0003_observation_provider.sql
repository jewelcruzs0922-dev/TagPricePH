-- Phase 12: a price is only trustworthy if you can say who reported it.
--
-- The table is still empty, so this is the cheap moment to require provenance:
-- every future row must name the provider that produced it, and 'unknown' is
-- reserved for rows that existed before that rule (there are none).

ALTER TABLE price_observations ADD COLUMN provider_id text;

UPDATE price_observations SET provider_id = 'unknown' WHERE provider_id IS NULL;

ALTER TABLE price_observations ALTER COLUMN provider_id SET NOT NULL;

-- Lets a bad source be audited or purged without scanning the whole history.
CREATE INDEX price_observations_provider_idx ON price_observations (provider_id);
