# Backend status

Honest state of the TagPricePH backend as of this delivery. Counts below come
from a clean `npm run verify:full` run (19 stages, all green).

## Completed

- **Migrations 0001–0010** applied and verified (44/44): ten tables, integer
  money, timestamptz observations, provenance columns, listing identity,
  alert mailbox tokens (0008 backfill + 0010 `NOT NULL`), one-active-alert
  and observation-idempotency constraints.
- **Database as source of truth**: `DATA_PROVIDER=db` serves reads entirely
  from Postgres through `lib/api/db-provider.ts` (search, product, related),
  with bulk loads so a product page is a handful of queries, not one per
  offer. Proven over HTTP: renaming a row in the database changes what the
  server renders (catalog:verify).
- **Fail-closed provider selection (§18)**: demo mode on → demo catalog; demo
  off with `DATA_PROVIDER` unset/`demo` → the app refuses with a reason
  instead of silently serving sample data (`lib/api/active-provider.ts`).
  Verified as unit checks and as a live server (403-level refusal logged).
- **Seed (`npm run catalog:seed`)**: idempotent; writes stores, products,
  offers, `marketplace_listings` identity (one row per URL, deduplicated),
  and the demo price series (provider `demo-seed`). Re-running changes
  nothing (150 products / 436 offers / 347 listings / 13,310 demo
  observations).
- **Ingest path**: `POST /api/ingest` normalizes, then persists catalog and
  observations in one transaction (`lib/db/catalog-sync.ts`) with listing
  identity resolution; the lock answers 401/401/200-refusal for
  wrong/wrong/right secret, and every outcome is logged as structured JSON
  (`lib/log.ts`), never with secrets.
- **Alert mailbox tokens (§25)**: first POST mints a token and returns it
  once; every later GET/POST/DELETE requires `x-alert-token` (403 otherwise),
  DELETE checks ownership before the token so id probing leaks nothing, POST
  is rate-limited per IP (429 + `Retry-After`, `lib/rate-limit.ts`).
  PriceAlert.tsx stores one token per email in localStorage.
- **Cron sweep (§26)**: `POST /api/alerts/check` always fails closed — no
  `CRON_SECRET` → 503 in *every* environment (no development bypass), wrong
  bearer → 401, right bearer → 200 with `{checked, triggered, asOf}`.
- **Observability**: structured `logEvent` lines for alert create/cancel/
  list failures, cron disabled/denied/complete/failed, ingest
  refusal/complete/failure.
- **Configuration**: `.env.example` documents every variable the code
  actually reads; secrets stay server-side and are audited against client
  bundles by security:verify (72/72).
- **Admin honesty fix**: the dashboard reports the observation table's real
  count (admin:verify now checks the rendered figure against `COUNT(*)`, and
  the copy no longer claims the table is empty).
- **Verify chain**: `npm run verify` = 18 stages; `npm run verify:full` adds
  `recorded:verify` (19). All green — see Tests.

## Remaining

- **Real marketplace data** — needs the user's marketplace API/affiliate
  credentials (blocked phases 4, 8, 27 of the original plan; see Marketplace
  integration blockers).
- **Live observation runs** — the ingest path is proven end-to-end with the
  demo provider and honest refusals without one; wiring an authorized
  provider is the remaining step.
- **Mail delivery** — none exists by design: email is an identity field, the
  UI says so; nothing sends mail.
- **Deployment configuration** — set the real secrets in the deployment
  environment and configure the scheduler to call the cron endpoint with
  `CRON_SECRET`.

## Known limitations

- **Rate limiter is in-memory per instance** (`lib/rate-limit.ts`): no
  Redis in this stack; one deployment instance counts for itself. Documented,
  not hidden.
- **No mail provider**: alerts live in the UI and the API only.
- **Demo is the only usable provider**: `db` is a read model over seeded
  data, not an independent source; `shopee`/`lazada`/`tiktok-shop` are
  registered but refuse honestly until credentials exist.
- **Render errors stream as 200**: a page that fails *after* headers commit
  sends status 200 with a truncated body — HTTP status alone cannot prove a
  refusal, which is why fail-closed checks assert the logged reason too.
- **Windows development**: verify scripts are Node-first but port hygiene and
  Chrome discovery assume a Windows workstation; no Docker.

## Production blockers

- `POSTGRES_URL` (and `DATABASE_URL_UNPOOLED` for migrations) must point at
  the production database; run `npm run db:migrate` first.
- `ADMIN_TOKEN`, `INGEST_SECRET`, `CRON_SECRET` must be set — each unset
  disables its surface (503/404/503), which is safe but inert.
- `NEXT_PUBLIC_DEMO_MODE=false` requires an explicit, non-`demo`
  `DATA_PROVIDER`, or the app refuses to serve (by design).
- A scheduler (e.g. Vercel cron) must call `POST /api/alerts/check` with
  `Authorization: Bearer $CRON_SECRET`; without it, alerts are only evaluated
  when someone opens the alerts page.

## Marketplace integration blockers

- **Shopee / Lazada / TikTok Shop**: no API credentials, affiliate keys, or
  rate-limit agreements supplied yet. Providers exist in the registry and
  refuse honestly; real observations (plan phase 4), marketplace APIs (phase
  8), and MVP scope (phase 27) all wait on those credentials.
- **Affiliate links**: the schema, redirect allowlist, and click tracking are
  in place with every `affiliate_url` null (nobody fabricates links); see
  `AFFILIATE_INTEGRATION.md` for exactly where real ones plug in.

## Environment variables required

All documented in `.env.example` (no real secrets in it):

| Variable | Required for | If unset |
| --- | --- | --- |
| `POSTGRES_URL` | app database access | pages/APIs that read fail |
| `DATABASE_URL_UNPOOLED` | migrations, verify scripts | falls back to pooled URLs |
| `NEXT_PUBLIC_DEMO_MODE` | data mode switch | defaults to demo-on |
| `DATA_PROVIDER` | provider when demo off | fail-closed refusal |
| `ADMIN_TOKEN` | `/admin` session gate | admin answers 503-style disabled |
| `INGEST_SECRET` | `POST /api/ingest` | 404, as if it did not exist |
| `CRON_SECRET` | `POST /api/alerts/check` | 503 in every environment |
| `CHROME_PATH` | mobile:verify only | auto-discovery |

## Database migration steps

1. Copy `.env.example` → `.env.local`, fill `DATABASE_URL_UNPOOLED`.
2. `npm run db:status` — lists all ten migrations and their state.
3. `npm run db:migrate` — applies any pending migration in order (recorded
   in `schema_migrations`, safe to re-run).
4. `npm run db:verify` — 44/44: schema, constraints, listing identity,
   idempotency, alert tokens (including `NOT NULL` enforcement).
5. `npm run catalog:seed` — fills the catalog and demo price history
   (idempotent).

## Tests

`npm run verify` (18 stages) and `npm run verify:full` (adds recorded:verify)
— final run: **all green, 489 scripted checks**:

| Stage | Count | Proves |
| --- | --- | --- |
| typecheck | — | TypeScript clean |
| lint | — | ESLint: 0 problems |
| build | — | production `next build` |
| trust:verify | 16 | honesty gates: demo labelling, no dressed-up data |
| db:verify | 44 | schema, constraints, migrations, tokens, money |
| data:verify | 27 | seed data integrity, images, categories |
| match:verify | 23 | matching contract: match/ambiguous/refuse |
| typo:verify | 33 | search typo tolerance |
| obs:verify | 18 | observation SQL: provenance, idempotency |
| ingest:verify | 22 | normalizer + transactional persistence, plausibility |
| views:verify | 16 | click/view tracking write path |
| alerts:verify | 39 | alert lifecycle + token SQL + trigger semantics |
| admin:verify | 35 | login gate, cookie, noindex, real figures |
| catalog:verify | 42 | fail-closed, row builders, seed fidelity, DB-vs-static parity over HTTP, ingest idempotency |
| security:verify | 72 | headers, secret exposure, redirect allowlist, ingest lock, alert tokens, rate limit, cron auth |
| providers:verify | 17 | registry refusal contracts |
| perf:verify | 39 | page weight and response budgets |
| mobile:verify | 28 | real Chrome viewport checks |
| recorded:verify | 18 | recorded history changes rendering, then restores the seed |
