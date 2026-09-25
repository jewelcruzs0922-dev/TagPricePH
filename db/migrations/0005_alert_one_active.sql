-- One active alert per email and product: resubmitting the form updates the
-- target instead of piling up duplicates. Triggered and cancelled rows are
-- outside the index on purpose — history never blocks watching the product
-- again, which is what lets a reached alert be re-armed with a new target.
CREATE UNIQUE INDEX price_alerts_one_active_idx
  ON price_alerts (email, product_slug)
  WHERE status = 'active';
