/**
 * SQL for price alerts, kept as plain strings so scripts/alerts-verify.mjs can
 * run the same statements against Postgres that the app does — the pattern
 * lib/db/view-queries.ts established for page views.
 */

/**
 * Creates an alert, or retargets the one that is already active for this
 * email and product. The predicate infers the partial unique index from
 * migration 0005, so only an *active* row can conflict: a triggered or
 * cancelled row is history and never blocks a fresh watch.
 *
 * The access token rides along on insert (§25). On retarget the conflict
 * path updates ONLY the price — the row keeps the token it was filed under,
 * so a caller proving possession of the mailbox token never rotates it out
 * from under another device.
 */
export const INSERT_ALERT_SQL = `
  INSERT INTO price_alerts (product_slug, target_price_cents, email, access_token)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (email, product_slug) WHERE status = 'active'
  DO UPDATE SET target_price_cents = EXCLUDED.target_price_cents
  RETURNING id::int AS id, product_slug, target_price_cents, status, created_at, triggered_at, access_token
`;

/**
 * The token this mailbox's rows were filed under. Every row an email has
 * shares one token (it is mailbox access, not row access); newest row wins
 * so the answer stays deterministic as rows are added.
 */
export const MAILBOX_TOKEN_SQL = `
  SELECT access_token
  FROM price_alerts
  WHERE email = $1 AND access_token IS NOT NULL
  ORDER BY id DESC
  LIMIT 1
`;

/** Who owns an alert id, and under what token — read before any cancel. */
export const ALERT_OWNER_SQL = `
  SELECT id::int AS id, email, access_token
  FROM price_alerts
  WHERE id = $1
`;

/** Everything one email is watching that has not been cancelled. */
export const LIST_ALERTS_SQL = `
  SELECT id::int AS id, product_slug, target_price_cents, status, created_at, triggered_at
  FROM price_alerts
  WHERE email = $1 AND status <> 'cancelled'
  ORDER BY created_at DESC, id DESC
`;

/** Cancels only rows the caller owns — email must match the row being changed. */
export const CANCEL_ALERT_SQL = `
  UPDATE price_alerts
  SET status = 'cancelled'
  WHERE id = $1 AND email = $2 AND status <> 'cancelled'
  RETURNING id::int AS id
`;

/** The working set for a check run: everything still waiting on a price. */
export const ACTIVE_ALERTS_SQL = `
  SELECT id::int AS id, product_slug, target_price_cents
  FROM price_alerts
  WHERE status = 'active'
  ORDER BY id
`;

/**
 * Flips one alert to triggered. Guarded on status so a concurrent check run
 * can never timestamp the same row twice — the loser of the race updates
 * nothing and returns no row.
 */
export const TRIGGER_ALERT_SQL = `
  UPDATE price_alerts
  SET status = 'triggered', triggered_at = now()
  WHERE id = $1 AND status = 'active'
  RETURNING id::int AS id, triggered_at
`;
