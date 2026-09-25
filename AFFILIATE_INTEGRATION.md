# Affiliate integration

**Status: not active.** Every `affiliate_url` column in the database is
`null` today, and that is asserted by the test suite (`offerRow carries no
fabricated affiliate link` in catalog:verify, `no fabricated affiliate
link` in db:verify). Nothing here claims any marketplace partnership exists;
this document records exactly where real links plug in once credentials and
affiliate agreements are supplied.

## What already exists

### Schema

- `offers.affiliate_url` — the monetising link for one offer row
  (`db/migrations/0001`). Written only when a provider supplies it.
- `marketplace_listings.affiliate_url` + `product_url` (0007) — the listing's
  own link, identity keyed by `(store_id, external_id)`.
- `click_events` — every outbound hop logs `placement`, `destination`,
  `referrer`, `user_agent`, and an optional `campaign`
  (0002), so revenue can be attributed to the button and page that earned it.

### The outbound hop

`GET /go/[store]/[product]` (`app/go`):

1. Resolves product × store → the stored URL (affiliate URL if present,
   product URL otherwise).
2. Runs it through the allowlist (`lib/api/affiliate.ts`):
   `isSafeRedirectUrl` refuses non-https, non-allowlisted hosts, lookalike
   hosts, `javascript:` URLs, and anything unparseable — an open redirect is
   not a monetisation feature.
3. Redirects and logs a `click_events` row with placement and campaign.

The allowlist is a constant (`ALLOWED_REDIRECT_HOSTS`) already covering the
three marketplaces; adding an affiliate network means adding its domain
there and nowhere else.

### Tracking placements

Buttons render through the `/go` hop with placement labels (e.g. listing
button vs offer row), so `click_events.placement` already distinguishes where
clicks came from — the reporting side needs no schema change.

## Where real affiliate URLs plug in

One field, one function per marketplace — the rest of the system is already
plumbed:

1. **Provider layer** (`lib/api/providers/`): when the marketplace
   provider is implemented (the three registered-but-refusing provider ids),
   its normalizer sets `affiliateUrl` on each offer/listing it reads —
   either from the marketplace's affiliate API or by appending the
   publisher's tracking parameters to the canonical product URL.
2. **Normalizer** (`lib/data/ingest.ts`): passes `affiliateUrl` through
   unchanged — there is deliberately no logic that invents or rewrites it.
3. **Persistence** (`lib/db/catalog-sync.ts`): `offerRow` and the listing
   upsert write the value into `offers.affiliate_url` /
   `marketplace_listings.affiliate_url` when (and only when) it is present.
4. **Read model** (`lib/api/db-provider.ts` → `assembleProduct`): surfaces
   it on the product page; `lib/pricing.ts` lowest-price logic never treats
   an affiliate parameter as a price change (compare canonical fields).
5. **Frontend**: product-page buttons already navigate via
   `/go/[store]/[product]`, so they start earning the moment step 1 exists —
   no component changes required.
6. **Allowlist** (`lib/api/affiliate.ts`): add any *new* affiliate network
   domain (e.g. a network's link shortener) to `ALLOWED_REDIRECT_HOSTS`.
   Marketplace domains are already listed.

## Per-marketplace activation checklist

For Shopee, Lazada, and TikTok Shop — none of these are done:

1. Obtain the marketplace's affiliate/publisher account and API (or
   deep-link format) — user-supplied credentials (blocked plan phases 8/27).
2. Register the link-generation step inside that marketplace's provider
   module (step 1 above).
3. Confirm the network's domains are on `ALLOWED_REDIRECT_HOSTS`.
4. Verify end-to-end: ingest → offer row shows a non-null
   `affiliate_url` → clicking the button lands on the marketplace with
   `click_events` logged → catalog:verify and db:verify still pass (their
   "no fabricated link" checks only fail when a link appears without a
   provider supplying it).

## Guarantees the suite enforces

- No affiliate URL is ever synthesized, guessed, or defaulted — empty stays
  `null` (catalog:verify, db:verify).
- Only allowlisted https hosts can be redirected to (security:verify:
  foreign host, plain http, `javascript:`, lookalike host, traversal, and
  campaign-parameter attempts all refused).
- Every hop is attributable (`click_events` with placement and campaign —
  views:verify exercises the write path).
