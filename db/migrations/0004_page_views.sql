-- Phase 10: the top of the funnel. click_events records the moment a shopper
-- leaves for a retailer; this records that they arrived at all, so
-- search → product view → outbound click can be measured end to end.
--
-- Deliberately anonymous: no IP address, no user id, no cookie, no user
-- agent. Only the product, when it was seen, and which external site sent
-- the shopper — nothing that identifies the person. The referrer is stored
-- as a hostname, never as free text.

CREATE TABLE page_views (
  id            bigserial   PRIMARY KEY,
  product_slug  text        NOT NULL,
  referrer_host text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX page_views_recent_idx ON page_views (created_at DESC);

CREATE INDEX page_views_product_idx ON page_views (product_slug, created_at DESC);
