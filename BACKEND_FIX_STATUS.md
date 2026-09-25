# BACKEND FIX STATUS

Targeted fix & polish pass per `BACKEND_FIX_PASS.md`. Backend only; the
frontend was touched only where a corrected backend contract made an existing
read wrong.

---

## Fixed

### FIX 1 — Affiliate URL plumbing
- `StoreOffer` now carries `affiliateUrl` (optional) and `listingId` (`lib/types.ts`).
- One centralized resolver, `resolveOutboundUrl(offer)` (`lib/api/affiliate.ts`):
  valid affiliate URL → valid product URL → `null`. It never derives, appends,
  or rewrites a destination.
- `/go/[store]/[product]` uses that resolver, records the click with the
  listing it left for, and no longer forwards `campaign`/`source` onto a
  marketplace URL — our attribution is recorded in `click_events`, never
  stamped onto a retailer's link as a parameter no programme asked for.
- Removed the fabricated `?ref=tagpriceph` from `getAffiliateUrl` and removed
  `affiliateConfig` (dead: `enabled:false`, empty params, only read by the
  route) so there is one affiliate mechanism, not two.
- `offers.affiliate_url` and `marketplace_listings.affiliate_url` are written
  from the offer when — and only when — a provider supplies one.

### FIX 2 — Listing / offer identity
- Migration `0011_offer_identity_and_search.sql` drops
  `UNIQUE (product_slug, store_id)` and adds `offers.external_id` with
  `UNIQUE (product_slug, store_id, external_id)` — one row per marketplace
  listing, idempotent on re-ingest, many sellers per product allowed.
- `upsertOffersSql` conflicts on that key; `offerRow` derives `external_id`
  with the same rule the migrations use.
- `click_events.listing_id` added so an outbound click names its listing.
- UI keys are now listing-scoped (`store:listing`) and `/go` chooses the
  eligible listing for a store instead of assuming one exists.

### FIX 3 — Variant identity
- Matching priority is now GTIN/EAN/UPC → manufacturer model number → SKU →
  brand + normalized model → variant attributes → fuzzy title. Identifiers are
  positive accelerators: a hit is decisive, a miss falls through to the title
  path (our catalog may simply not carry that barcode yet).
- Model-discriminating tokens (`pro`, `max`, `plus`, `ti`, `fe`, `gen2`, …)
  are compared **symmetrically**: present on exactly one side ⇒ not the same
  product. Fixes `iPhone 16` ↔ `iPhone 16 Pro` and `RTX 5060` ↔ `RTX 5060 Ti`
  in both directions.
- Capacities are extracted as a set, and standalone numbers (model numbers,
  screen diagonals, apparel sizes) and letter sizes (`s/m/l/xl`) are collected
  as separate sets. All three use one disagreement rule: each side stating a
  value the other lacks refuses the match, while a side that states *less*
  ("Pegasus 40" against "Pegasus 40 Size 8") stays ambiguous rather than being
  attached to one. "Size 8" vs "Size 10" therefore separates even when both
  share a model number, and 128GB vs 256GB still cannot collide.
- Condition: `isUsedTitle` refuses a used/refurbished listing against a new
  product and vice versa, read from the raw title (tokenisation strips exactly
  the words that mark the other side). A second-hand unit can never become
  this product's "lowest price".
- Bundle detection (`isBundleTitle`): a bundle word, or `+ <accessory>`.
  Bundle-ness is compared on both sides, so a bundle matches itself and never
  matches the standalone product. `+ Free Shipping` / `16+512` are not bundles.

### FIX 4 — Freshness is part of price ranking
- `FreshnessState` is now `fresh | aging | stale | unknown` (48h / 14d /
  unreadable), thresholds unchanged and still configurable.
- One eligibility funnel: `checkOfferEligible` → `getEligibleCurrentOffers` →
  `getLowestOffer` / `getSavings`. Pipeline: valid URL → valid price → right
  product/variant → available → fresh enough.
- Every ranking surface now goes through it: `getLowestOffer`, `getSavings`,
  search sort, product page, comparison table, homepage deal list, alert
  trigger, `/go` offer choice. `StoreComparison.canRank` delegates instead of
  re-stating the rule.
- All-stale ⇒ `getLowestOffer` returns `null`; surfaces render
  "Unavailable"/"—" rather than a stale number. `evaluateBuyTiming` declines
  to judge instead of computing against ₱0.
- A stale high price can no longer inflate a savings figure.

### FIX 5 — Conservative source classification
- `getDataSource` returns `live` only when **every** offer is live. One demo
  offer, one unreadable source, or no offers ⇒ `demo`. Row order can no longer
  decide a product's provenance.

### FIX 6 — Database search fields
- `products.model_number` and `products.gtin` added (migration 0011) with
  indexes, plus an index on `sku`.
- `CATALOG_SEARCH_SQL` now prefilteres on name, brand, slug, category, model
  number (substring), keywords (`unnest`, since `ILIKE ANY` rejects an array on
  the left), SKU / model / GTIN (exact, case-insensitive — `%49712%` must not
  match a different barcode), and marketplace external listing ids (exact).
- Input stays escaped; still bounded at 200 candidates, never a full-catalog
  load; in-process ranking unchanged on top.

### FIX 7 — Production reads use the database
- New `lib/data/catalog.ts` is the provider seam for list surfaces. The
  homepage, `/categories`, `/categories/[slug]`, `/price-drops`, the sitemap,
  the search facet, typeahead (`/api/suggestions`) and admin catalog stats all
  read through `getActiveProvider()` instead of `lib/data/products.ts`.
- An empty/unusable catalog renders an honest empty state (or zeros with the
  provider's reason) — never the static sample rows.
- Sample labels now derive from the product's own offers
  (`isSampleClaim(product)`), not from a global flag about the seed catalog,
  so a DB-served live row is never labelled sample and vice versa. The sample
  date shown is the product's own newest reading.

### FIX 8 — Price-drop correctness
- `RecordedDrop` exposes `previousPrice`, `currentPrice`, `absoluteDrop`,
  `percentageDrop`, `observedAt` alongside the copy fields.
- `buildPriceDropFeed` (`lib/data/price-drops.ts`) is the single definition
  used by both `/price-drops` and the homepage: verified observations first,
  the sample reference price only while the catalog is sample, otherwise
  nothing (the page shows an empty state instead of decorating non-drops).
- The struck-through "was" price is no longer rendered for live products.

### FIX 9 — Redirect safety
- Audited and tested: known stores only, offer must exist, destinations
  allowlisted (https only), `javascript:`/`data:`/look-alike hosts refused,
  affiliate preferred with product-URL fallback, clicks recorded, unknown
  product/store redirect back inside the app (behaviour asserted by
  `security:verify`, preserved unchanged).

### Surfaces that assumed a price always exists
The eligibility funnel made "there is no current price" a real state, so three
renderings that hardcoded `?? 0` were corrected — ₱0 is a price nobody is
charging:
- `PriceHistoryChart` takes `currentPrice: number | null`; null keeps the
  scale honest, relabels the marker "Last recorded", and prints "Unavailable"
  in the Current stat.
- `PriceAlertForm` takes `suggestedPrice: number | null`; no target is
  prefilled from nothing and the hint says so.
- The homepage deal list badges only an eligible offer as "Lowest listed
  price" and labels anything else "Not current"/"Out of stock", so it can
  never disagree with the hero.
- `.env.example` documented `DATA_PROVIDER=tiktok-shop`; the registered id is
  `tiktok`. Corrected (environment variables are on the fix pass's audit
  list).

### FIX 10 — Existing security preserved
- Verified, not modified: alert token authorization (email alone authorizes
  nothing), cron fails closed with no `CRON_SECRET`, secrets never reach the
  client bundle, per-IP alert rate limiting, admin session gate.

### FIX 11 — Tests
- New `scripts/backend-fix-verify.mjs` → `npm run backend:verify` (62 checks:
  affiliate plumbing, redirect safety, eligibility/freshness, source
  classification, verified drops, search haystack + live SQL prefilter, offer
  identity), wired into `npm run verify`.
- `scripts/match-verify.mjs` +24 checks for FIX 3's required cases (model,
  bundle, identifier, size and condition).
- `scripts/db-verify.mjs` offer-identity tests updated: same listing rejected,
  second listing for the same product+store accepted.
- `scripts/catalog-verify.mjs` row-width assertions updated (16/15/10
  columns) plus a check that `offerRow` derives the migration's external id.
- `scripts/alias-resolver.mjs` lets plain Node load `@/`-aliased app modules
  so these suites test the real code, not a copy.

---

## Not changed because already correct

- Provider fail-closed selection (`selectActiveProviderId`), marketplace
  adapters refusing with a reason, and the demo provider being clearly
  separate from the interface.
- Trust gates: sample data never reaches Product JSON-LD, the meta description
  leads with the caveat, every page carries its label.
- `getRecordedPriceDrop`'s refusal logic (only the returned fields were
  extended).
- Alert security, cron lock, secret handling, rate limiting, admin session.
- `/go`'s internal redirects for unknown products/stores (existing tested
  contract).
- `lib/data/products.ts` (demo seed) and the demo provider — retained as the
  seed source, not deleted.
- Shape of the schema beyond migration 0011: `marketplace_listings`,
  `product_variants`, `price_observations` were already fit for purpose.

---

## Remaining limitations

- `affiliate_url` is NULL everywhere until a marketplace's own affiliate
  programme supplies a real link. By design — nothing here can invent one.
- Ratings/review counts are still demo seed values. Hidden while the product
  is sample; must be sourced or removed before any live product shows them.
- Buy timing needs ≥14 recorded observations, and the demo series is generated
  (labelled sample everywhere it appears).
- Source classification is `demo | live` only — "mixed" reports as `demo`
  (conservative, and the DB CHECK constraint allows only those two).
- The matcher has no GTIN/model data in the seed catalog, so those identifier
  paths are exercised by tests rather than by real rows.
- `product_variants` stays empty: each purchasable configuration is its own
  product row, per Phase 7's matching contract.
- Dead exports left in place: `isDemoData`, `DEMO_AS_OF`, `getBrands`,
  `getSuggestions` are no longer read by any page.
- A database seeded more than 14 days ago serves "no current price" until it
  is re-seeded — honest, but it means `catalog:seed` becomes a scheduled job.

---

## Production blockers

1. **No authorized marketplace data source.** Shopee, Lazada and TikTok Shop
   adapters are registered but refuse; no API credentials, no permitted feed.
2. **No affiliate programme accepted**, so there is no commission path and
   every outbound link is a plain product URL.
3. **No live writer.** `price_observations` holds only `demo-seed` rows;
   `planIngestion` refuses every current provider, by design.
4. **No scheduler.** `/api/alerts/check` fails closed and nothing calls it.
5. **Catalog is 150 demo rows.** Needs the seed → 20–50 genuinely tracked
   products before any traffic is worth sending.
6. **Ratings/reviews have no real source** (see limitations).
7. **Alerts do not deliver.** They are stored and triggered; no mail/push
   provider exists, and the UI says so.

---

## Marketplace integration blockers

- Authorized API/feed credentials per marketplace (rate limits, terms,
  attribution rules) — none held today.
- Each marketplace's **official** affiliate link format and the credentials to
  mint one; `offers.affiliate_url` is ready to receive it and nothing else is.
- Variant identifiers (GTIN/EAN/UPC, manufacturer model number) in the feed —
  the columns and matcher priority now exist, the data does not.
- A scheduled ingestion job (cron) with `CRON_SECRET` configured.
- Per-marketplace freshness cadence: tune `FRESHNESS_THRESHOLDS` once each
  provider's real check interval is known.

---

## Tests run

Full `npm run verify` (typecheck → lint → build → 16 suites):

| Suite | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| `eslint .` | clean (0 errors, 0 warnings) |
| `next build` | success, 169 pages |
| `trust:verify` | 16/16 |
| `db:verify` | 45/45 |
| `data:verify` | 27/27 |
| `match:verify` | 47/47 |
| `backend:verify` | 62/62 |
| `typo:verify` | 33/33 |
| `obs:verify` | 18/18 |
| `ingest:verify` | 22/22 |
| `views:verify` | 16/16 |
| `alerts:verify` | 39/39 |
| `admin:verify` | 35/35 |
| `catalog:verify` | 44/44 |
| `security:verify` | 72/72 |
| `providers:verify` | 17/17 |
| `perf:verify` | 39/39 |
| `mobile:verify` | 28/28 |

`npm run recorded:verify` → 18/18.

**Total: 578 assertions passing, 0 failing.**

## Build/typecheck status

- `npm run typecheck` — pass.
- `npm run lint` — pass.
- `npm run build` — pass (169 static pages, 169/169 generated).
- Migration `0011` applied; `npm run catalog:seed` re-run against the new
  constraints (150 products, 436 offers, 347 listings).

---

## Verdict

The backend is ready for the next integration phase: an authorized marketplace
adapter and an approved affiliate link can be dropped in behind
`MarketplaceProvider` / `offers.affiliate_url` without touching the read path,
the ranking rules, or the UI. What is missing is access and data, not
architecture — and nothing in this pass pretends otherwise.
