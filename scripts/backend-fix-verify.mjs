#!/usr/bin/env node
/**
 * Backend fix pass verification — BACKEND_FIX_PASS.md, fixes 1–9 and 11.
 *
 * Covers the behaviour the fix pass changed and that the older suites do not
 * reach:
 *
 *   FIX 1 / 9  affiliate URL plumbing and outbound redirect safety
 *   FIX 2      offer identity (product + store + external listing id)
 *   FIX 4      freshness-aware ranking and the single eligibility funnel
 *   FIX 5      conservative live/demo classification
 *   FIX 6      database search fields (sku / model / gtin / keywords / listing id)
 *   FIX 8      price drops that come only from observations
 *
 * FIX 3's variant cases live in scripts/match-verify.mjs (same fixtures, same
 * suite); FIX 2's database constraints live in scripts/db-verify.mjs; FIX 10's
 * alert/cron/secret guarantees live in scripts/security-verify.mjs. This script
 * points at those rather than duplicating them.
 *
 * Usage: node scripts/backend-fix-verify.mjs
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import pg from "pg";

// The app imports through the tsconfig `@/` alias; Node does not read tsconfig.
registerHooks({ resolve: (await import("./alias-resolver.mjs")).resolve });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const {
  ALLOWED_REDIRECT_HOSTS,
  getAffiliateUrl,
  isSafeRedirectUrl,
  resolveOutboundUrl,
} = await import("../lib/api/affiliate.ts");
const {
  checkOfferEligible,
  getEligibleCurrentOffers,
  getLowestOffer,
  getRecordedPriceDrop,
  getPriceDropPercent,
  getSavings,
} = await import("../lib/pricing/index.ts");
const { getDataSource } = await import("../lib/data/observations.ts");
const { getFreshness, FRESHNESS_THRESHOLDS } = await import("../lib/utils/freshness.ts");
const { filterAndSortProducts } = await import("../lib/data/search-core.ts");
const {
  CATALOG_SEARCH_SQL,
  deriveExternalId,
  offerRow,
  upsertOffersSql,
} = await import("../lib/db/catalog-queries.ts");

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const DAY = 86_400_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

const offer = (overrides = {}) => ({
  storeId: "shopee",
  price: 45_000,
  url: "https://shopee.ph/item/1234567890",
  updatedAt: iso(0),
  inStock: true,
  source: "live",
  ...overrides,
});

const product = (overrides = {}) => ({
  id: "p",
  slug: "iphone-16-128gb",
  name: "iPhone 16 128GB",
  brand: "Apple",
  category: "phones",
  image: "/x.jpg",
  offers: [],
  priceHistory: [],
  ...overrides,
});

/* ------------------------------------------------------------------ *
 * FIX 1 + 9 — affiliate URL plumbing and redirect safety
 * ------------------------------------------------------------------ */

console.log("\nAffiliate plumbing (FIX 1 / FIX 9)");

{
  const affiliate = offer({ affiliateUrl: "https://shopee.ph/aff/abc123" });
  check(
    "a stored affiliate URL is the destination when it is valid",
    resolveOutboundUrl(affiliate) === "https://shopee.ph/aff/abc123",
    String(resolveOutboundUrl(affiliate)),
  );
}
{
  const plain = offer();
  check(
    "a normal product URL is used when there is no affiliate URL",
    resolveOutboundUrl(plain) === plain.url,
    String(resolveOutboundUrl(plain)),
  );
}
{
  const foreign = offer({ affiliateUrl: "https://evil.example/aff" });
  check(
    "an affiliate URL outside the allowlist is rejected, and the offer's own URL is used instead",
    resolveOutboundUrl(foreign) === foreign.url,
    String(resolveOutboundUrl(foreign)),
  );
}
{
  const bothBad = offer({ url: "https://evil.example/item", affiliateUrl: "https://evil.example/aff" });
  check("an unknown destination is refused, not redirected to", resolveOutboundUrl(bothBad) === null);
}
{
  const schemes = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://shopee.ph/item",
    "https://shopee.ph.evil.example/item",
    "https://evil.com/?host=shopee.ph",
    "not a url",
  ];
  check(
    "javascript:, data:, non-https, look-alike hosts and junk are all refused",
    schemes.every((value) => !isSafeRedirectUrl(value)),
    schemes.filter((value) => isSafeRedirectUrl(value)).join(", "),
  );
  check(
    "every allowlisted host is reachable",
    ALLOWED_REDIRECT_HOSTS.every((host) => isSafeRedirectUrl(`https://${host}/x`)),
  );
}
{
  const resolved = resolveOutboundUrl(offer({ affiliateUrl: "https://shopee.ph/aff/abc" }));
  check(
    "the resolver never appends or rewrites anything on the destination",
    resolved === "https://shopee.ph/aff/abc",
    String(resolved),
  );
}
{
  const href = getAffiliateUrl({ id: "shopee", name: "Shopee" }, { id: "x", slug: "iphone-16-128gb" });
  const withContext = getAffiliateUrl(
    { id: "shopee", name: "Shopee" },
    { id: "x", slug: "iphone-16-128gb" },
    { source: "product-hero", campaign: "9.9" },
  );
  check("the outbound link is our own /go path", href === "/go/shopee/iphone-16-128gb", href);
  check(
    "no fabricated affiliate parameter is ever attached",
    !href.includes("ref=") && !href.includes("aff="),
    href,
  );
  check(
    "our own attribution travels as campaign/source only",
    withContext === "/go/shopee/iphone-16-128gb?campaign=9.9&source=product-hero",
    withContext,
  );
}

/* ------------------------------------------------------------------ *
 * FIX 4 — freshness is part of price ranking
 * ------------------------------------------------------------------ */

console.log("\nFreshness-aware ranking (FIX 4)");

{
  const fresh = offer({ price: 45_000, updatedAt: iso(2 * 3_600_000) });
  const stale = offer({ storeId: "lazada", url: "https://lazada.com.ph/items/1", price: 40_000, updatedAt: iso(20 * DAY) });
  const lowest = getLowestOffer([stale, fresh]);
  check(
    "a 20-day-old ₱40,000 cannot beat a 2-hour-old ₱45,000",
    lowest?.price === 45_000 && lowest?.storeId === "shopee",
    JSON.stringify(lowest ?? null),
  );
  check(
    "the stale offer is still visible as data, just not as the current price",
    getEligibleCurrentOffers([stale, fresh]).length === 1,
    String(getEligibleCurrentOffers([stale, fresh]).length),
  );
}
{
  const onlyStale = [offer({ updatedAt: iso(30 * DAY) }), offer({ storeId: "lazada", updatedAt: iso(40 * DAY) })];
  check(
    "when every offer is stale there is no current lowest price",
    getLowestOffer(onlyStale) === null,
  );
}
{
  const staleButCheap = offer({ price: 30_000, updatedAt: iso(30 * DAY) });
  const freshButDear = offer({ storeId: "lazada", url: "https://lazada.com.ph/items/2", price: 45_000 });
  check(
    "savings compare eligible offers only — a stale high price cannot inflate them",
    getSavings([staleButCheap, freshButDear]) === 0,
    String(getSavings([staleButCheap, freshButDear])),
  );
  check(
    "two fresh offers still produce a real saving",
    getSavings([offer({ price: 45_000 }), offer({ storeId: "lazada", url: "https://lazada.com.ph/items/3", price: 50_000 })]) === 5_000,
  );
}
{
  const cases = [
    ["an out-of-stock listing cannot win", offer({ inStock: false }), "out_of_stock"],
    ["another variant cannot win", offer({ condition: "different_variant" }), "different_variant"],
    ["a bundle cannot win", offer({ condition: "bundle" }), "bundle"],
    ["an unusable price cannot win", offer({ price: 0 }), "invalid_price"],
    ["a NaN price cannot win", offer({ price: Number.NaN }), "invalid_price"],
    ["an off-allowlist URL cannot win", offer({ url: "https://evil.example/x" }), "invalid_url"],
    ["an undated offer cannot win", offer({ updatedAt: "not-a-date" }), "stale"],
    ["a stale offer cannot win", offer({ updatedAt: iso(20 * DAY) }), "stale"],
    ["a fresh, in-stock, single-item listing is eligible", offer(), null],
    ["an aging but inside-window listing is still eligible", offer({ updatedAt: iso(3 * DAY) }), null],
  ];
  for (const [label, candidate, expected] of cases) {
    check(label, checkOfferEligible(candidate) === expected, String(checkOfferEligible(candidate)));
  }
}
{
  const { freshMs, staleMs } = FRESHNESS_THRESHOLDS;
  check("within the cadence window reads fresh", getFreshness(iso(0)) === "fresh");
  check("past the cadence but inside the window reads aging", getFreshness(iso(freshMs + 60_000)) === "aging");
  check("past the window reads stale", getFreshness(iso(staleMs + 60_000)) === "stale");
  check("an unreadable timestamp reads unknown", getFreshness("yesterday") === "unknown");
}

/* ------------------------------------------------------------------ *
 * FIX 5 — conservative demo/live classification
 * ------------------------------------------------------------------ */

console.log("\nSource classification (FIX 5)");

const live = { ...offer(), source: "live" };
const demo = { ...offer({ storeId: "lazada", url: "https://lazada.com.ph/items/9" }), source: "demo" };

check("all live → live", getDataSource(product({ offers: [live, { ...live, storeId: "sm", url: "https://smstore.com/x" }] })) === "live");
check("live + demo → demo (mixed never reads live)", getDataSource(product({ offers: [live, demo] })) === "demo");
check("demo + live → demo (order cannot decide)", getDataSource(product({ offers: [demo, live] })) === "demo");
check("all demo → demo", getDataSource(product({ offers: [demo] })) === "demo");
check("no offers at all → demo (unknown is not live)", getDataSource(product({ offers: [] })) === "demo");

/* ------------------------------------------------------------------ *
 * FIX 8 — price drops come from observations
 * ------------------------------------------------------------------ */

console.log("\nVerified price drops (FIX 8)");

const series = (source, points) => ({ source, points });

{
  // The doc's own example: the last recorded observation *is* the current
  // price, so the drop is measured from the reading before it.
  const drop = getRecordedPriceDrop(
    series("live", [
      { date: "2026-09-01", price: 10_000 },
      { date: "2026-09-25", price: 9_000 },
    ]),
    9_000,
  );
  check("10000 → 9000 is a verified drop", drop !== null);
  check(
    "the drop names both readings and both magnitudes",
    drop?.previousPrice === 10_000 &&
      drop?.currentPrice === 9_000 &&
      drop?.absoluteDrop === 1_000 &&
      drop?.percentageDrop === 10 &&
      typeof drop?.observedAt === "string",
    JSON.stringify(drop ?? null),
  );
}
{
  // Not yet observed as its own reading: the newest observation is the
  // baseline, so the drop is measured against the most recent thing we recorded.
  const drop = getRecordedPriceDrop(
    series("live", [
      { date: "2026-09-01", price: 10_000 },
      { date: "2026-09-20", price: 9_500 },
    ]),
    9_000,
  );
  check(
    "an unobserved current price is compared with the newest recorded reading",
    drop?.previousPrice === 9_500 && drop?.absoluteDrop === 500,
    JSON.stringify(drop ?? null),
  );
}
{
  check(
    "one reading alone is not a drop",
    getRecordedPriceDrop(series("live", [{ date: "2026-09-20", price: 9_000 }]), 9_000) === null,
  );
  check(
    "an empty series is not a drop",
    getRecordedPriceDrop(series("live", []), 9_000) === null,
  );
  check(
    "a price that did not fall is not a drop",
    getRecordedPriceDrop(
      series("live", [
        { date: "2026-09-01", price: 9_000 },
        { date: "2026-09-20", price: 9_500 },
      ]),
      9_500,
    ) === null,
  );
}
{
  const generated = series("demo", [
    { date: "2026-09-01", price: 10_000 },
    { date: "2026-09-20", price: 9_000 },
  ]);
  check(
    "a generated series never yields a verified drop",
    getRecordedPriceDrop(generated, 9_000) === null,
  );
}
{
  const liveProduct = product({
    offers: [live],
    previousPrice: 60_000, // a listed "was" price nobody observed
    dropPercent: 25,
  });
  check(
    "a demo marketing price cannot claim a drop on a live product",
    getPriceDropPercent(liveProduct) === null,
    String(getPriceDropPercent(liveProduct)),
  );
}

/* ------------------------------------------------------------------ *
 * FIX 6 — search
 * ------------------------------------------------------------------ */

console.log("\nSearch (FIX 6)");

{
  const catalog = [
    product({ id: "a", slug: "iphone-16-128gb", sku: "MPTR3ZA/A", modelNumber: "A3090", gtin: "0195949030190" }),
    product({ id: "b", slug: "iphone-16-256gb", name: "iPhone 16 256GB", sku: "MPXH3ZA/A" }),
  ];
  const find = (q) => filterAndSortProducts(catalog, q, {}, "lowest-price").map((p) => p.slug);
  check("a query by name finds the product", find("iPhone 16 256GB").includes("iphone-16-256gb"));
  check("a query by brand finds the products", find("Apple").length === 2);
  check("a query by SKU finds the product", find("MPXH3ZA/A").includes("iphone-16-256gb"));
  check("a query by model number finds the product", find("A3090").includes("iphone-16-128gb"));
  check("a query by GTIN finds the product", find("0195949030190").includes("iphone-16-128gb"));
}

/* --------------------------- database search ---------------------- */

function resolveConnectionString() {
  const candidates = [
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_URL,
    process.env.DATABASE_URL,
  ].filter(Boolean);
  const url = candidates.find((value) => !value.includes("-pooler")) ?? candidates[0];
  if (!url || url.includes("SENSITIVE")) {
    console.error("No usable Postgres connection string found in .env.local.");
    process.exit(1);
  }
  return url;
}

/** Mirrors db-provider's prefilter inputs: `%word%` patterns + raw words. */
function searchParams(query) {
  const words = query.trim().split(/\s+/).filter(Boolean);
  return [
    words.map((word) => `%${word.replace(/[\\%_]/g, (char) => `\\${char}`)}%`),
    words,
  ];
}

async function databaseChecks() {
  console.log("\nDatabase search prefilter (FIX 6)");
  const client = new pg.Client({ connectionString: resolveConnectionString() });
  await client.connect();
  const slug = "verify-fix-search";

  try {
    await client.query("DELETE FROM products WHERE slug = $1", [slug]);
    await client.query(
      `INSERT INTO products (slug, name, brand, category_slug, sku, image, source, keywords, model_number, gtin)
       VALUES ($1, 'Verify Fix Product', 'VerifyFix', 'phones', 'VERIFY-FIX-SKU', '/x.jpg', 'demo',
               '{"verifyfixkeyword"}', 'VERIFY-FIX-MODEL', '4809999000017')`,
      [slug],
    );

    const names = async (query) => {
      const { rows } = await client.query(CATALOG_SEARCH_SQL, searchParams(query));
      return rows.map((row) => row.slug);
    };

    check("the SQL prefilter matches by name", (await names("verify fix product")).includes(slug));
    check("the SQL prefilter matches by SKU", (await names("VERIFY-FIX-SKU")).includes(slug));
    check("SKU matching is case-insensitive", (await names("verify-fix-sku")).includes(slug));
    check("the SQL prefilter matches by manufacturer model number", (await names("verify-fix-model")).includes(slug));
    check("the SQL prefilter matches by GTIN", (await names("4809999000017")).includes(slug));
    check("the SQL prefilter matches by normalized keyword", (await names("verifyfixkeyword")).includes(slug));
    check("a query for nothing finds nothing", (await names("no-such-product-zzz")).length === 0);
    check(
      "a wildcard in the query is a literal, not a match-everything",
      !(await names("%")).includes(slug),
      (await names("%")).join(", "),
    );

    // The listing id is searchable so a pasted marketplace URL's id can land.
    await client.query(
      `INSERT INTO marketplace_listings (store_id, external_id, product_slug, title, product_url, source, status)
       VALUES ('shopee', '/verify-fix-listing', $1, 'Verify Fix Listing', 'https://shopee.ph/verify-fix', 'demo', 'active')`,
      [slug],
    );
    check(
      "a marketplace external listing id is searchable",
      (await names("/verify-fix-listing")).includes(slug),
    );
  } finally {
    await client.query("DELETE FROM marketplace_listings WHERE external_id = '/verify-fix-listing'");
    await client.query("DELETE FROM products WHERE slug = $1", [slug]);
    await client.end();
  }

  console.log("\nOffer identity (FIX 2 — schema constraints asserted in db:verify)");
  const derived = deriveExternalId("https://shopee.ph/item/i.1.2", "slug", "shopee");
  const surrogate = deriveExternalId("https://shopee.ph", "slug", "shopee");
  check("a listing URL keeps its own id", derived === "/item/i.1.2", derived);
  check("a store-homepage URL falls back to the slug:store surrogate", surrogate === "slug:shopee", surrogate);
  check(
    "the offer upsert conflicts on product + store + external listing id",
    /ON CONFLICT \(product_slug, store_id, external_id\)/.test(upsertOffersSql(1)),
  );
  const row = offerRow(
    product({ offers: [] }),
    offer({ url: "https://shopee.ph/item/i.9.9" }),
    7,
  );
  check("offerRow carries that same external id in its last column", row[14] === "/item/i.9.9", String(row[14]));
  check("offerRow still writes no affiliate link it was not given", row[8] === null);
  check(
    "offerRow writes the affiliate link it *was* given",
    offerRow(product({ offers: [] }), offer({ affiliateUrl: "https://shopee.ph/aff/1" }), 7)[8] ===
      "https://shopee.ph/aff/1",
  );
}

try {
  await databaseChecks();
} catch (error) {
  check(`database checks ran`, false, error instanceof Error ? error.message : String(error));
}

console.log(`\n${passed}/${passed + failed} checks passed.`);
if (failed > 0) process.exit(1);
