# Backend architecture

How a price reaches the screen, stage by stage. Every stage is a small module
with a script-testable core — no stage trusts the one before it silently.

```
Provider → Normalizer → Matcher → Database → Offers → Observations
                                                        ↓
Frontend ← API ← Price intelligence ←────────────────────┘
```

## 1. Provider — where readings come from

`lib/api/registry.ts` + `lib/api/active-provider.ts`

A provider implements one contract: list/search/get products with normalized
offers. Registered: `demo`, `db`, `shopee`, `lazada`, `tiktok-shop`.

Selection is **fail-closed** (§18), decided once in `selectActiveProviderId`:

- demo mode on → `demo`, whatever `DATA_PROVIDER` says;
- demo off + `DATA_PROVIDER` unset/blank → error, *refusing to fall back*;
- demo off + `DATA_PROVIDER=demo` → error, contradiction;
- demo off + a named provider → that provider, or an honest refusal if it
  cannot serve (`assertUsableProvider` never treats a missing credential as
  "temporarily demo").

`db` (`lib/api/db-provider.ts`) is not an independent source: it is the
read model over the seeded database (`source: "demo"`), and it throws if the
catalog is empty rather than pretending. The registered marketplace providers
exist but refuse until credentials arrive.

## 2. Normalizer — one shape in, one shape out

`lib/data/ingest.ts`

Raw provider output becomes `Product` rows with offers in fixed fields
(price in integer centavos, PHP currency, availability enum, store id, URL).
Refusal reasons (`providerRefusal`) are explicit: a provider may never add
readings, a DB read model may never be treated as a source of new readings.
`lib/db/catalog-sync.ts` persists a normalized batch in one transaction.

## 3. Matcher — titles to catalog

`lib/matching/index.ts`, `lib/search/typo.ts`

Listing titles resolve to a product slug with a three-way contract —
`match`, `ambiguous`, `refuse` — preferring an exact SKU over fuzzy text,
honoring stated storage/colour variants, and refusing when nothing clears
the bar. Typo tolerance lives in search, not in the matcher.

## 4. Database — source of truth

Ten tables (`db/migrations/0001`–`0010`), all through parameterised SQL in
`lib/db/*-queries.ts`:

| Table | Role |
| --- | --- |
| `products`, `product_variants` | catalog spine (slug identity, metadata) |
| `stores` | the five retailers + the `demo` pseudo-store |
| `offers` | current price per product × store, provenance `demo`/`live` |
| `marketplace_listings` | one row per marketplace URL (store + external id), offer→listing link |
| `price_observations` | append-only history with `provider_id`, `source`, idempotency key |
| `price_alerts` | targets per email, mailbox `access_token`, status lifecycle |
| `click_events`, `page_views` | attribution (placement, campaign) and view counts |
| `schema_migrations` | applied versions |

Money is integer centavos end-to-end (`lib/db/money.ts`); timestamps are
`timestamptz`.

## 5. Offers — the current price

Reads assemble a `Product` the same way in both modes (`assembleProduct`):
offers + series bulk-loaded (no N+1), lowest offer computed by
`lib/pricing.ts`. Every offer carries its `source`; UI honesty banners read
the source, never an env flag, so demo data cannot be dressed up as live.
`affiliate_url` is stored only when a provider supplies one — never
fabricated (asserted by db:verify and catalog:verify).

## 6. Observations — the recorded history

`lib/db/observation-queries.ts`, `scripts/seed.mjs`

Append-only readings; the idempotency index (0008) makes a re-posted
observation a no-op. The demo series (13,310 rows, provider `demo-seed`,
store `demo`) is written by the seed so history in demo mode is *real rows
in the database*, not synthesized at render time. Ingest writes observations
in the same transaction as the catalog sync; demo and live readings at the
same instant stay separate rows (different source/provider).

## 7. Price intelligence

`lib/db/observations.ts`, `app/price-drops`

Series resolution (chart points), buy-timing hints, and price-drop
detection all read observations first and fall back to catalog/sample labels
explicitly — the page says which one it is showing ("Updated from recorded
prices" vs "Updated from demo catalog").

## 8. API

| Route | Role |
| --- | --- |
| `GET /api/search`, `/api/suggestions` | catalog search through the active provider |
| `POST /api/ingest` | secret-locked batch ingest (404 when unconfigured) |
| `GET/POST/DELETE /api/alerts` | mailbox-token-guarded alert CRUD + live trigger check; POST rate-limited |
| `POST /api/alerts/check` | cron sweep, always fail-closed (503/401/200) |
| `POST/DELETE /api/admin/session` | token→hash cookie gate |
| `POST /api/views` | view/click attribution |
| `GET /go/[store]/[product]` | outbound redirect, allowlisted hosts only (`lib/api/affiliate.ts`) |

Server components read the database directly (`force-dynamic` pages); the
client only talks to these routes.

## 9. Frontend

App Router pages render from server reads; `PriceAlert.tsx` is the one
stateful client piece: it keeps a per-email mailbox token in localStorage
(`tagpriceph-alert-tokens`) and sends it as `x-alert-token` on every call —
without it the server refuses (403), which the UI surfaces. The admin
dashboard (`app/admin/page.tsx`) renders `loadAdminStats()` figures verbatim
from the database.

## Cross-cutting

- **Logging**: one JSON line per event (`lib/log.ts`), dotted event names,
  never secrets or raw emails.
- **Config**: `.env.example` is the contract; server-only values are never
  `NEXT_PUBLIC_` (audited by security:verify against the client bundles).
- **Testing**: every stage has a `*:verify` script; the chain is
  `npm run verify:full` (19 stages, 489 checks).
