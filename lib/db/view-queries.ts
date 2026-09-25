/**
 * SQL for the page_views table, shared by the write path
 * (lib/db/views.ts) and scripts/views-verify.mjs so the two cannot drift.
 */
export const INSERT_VIEW_SQL = `INSERT INTO page_views (product_slug, referrer_host)
  VALUES ($1, $2)`;
