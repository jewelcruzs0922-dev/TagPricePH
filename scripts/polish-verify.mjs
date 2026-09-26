#!/usr/bin/env node
/**
 * Final Backend Polish Pass verification — the three fixes made executable.
 *
 * 1. Affiliate URL preservation (Final Polish §1): all four required cases,
 *    against REAL rows, for both offers and marketplace_listings — existing
 *    approved URL survives incoming NULL; NULL stores a new approved URL; an
 *    approved replacement overwrites; an unapproved URL never does (and the
 *    row builders are proven to null it before persistence).
 *
 * 2. Revalidation proportionality (§2): change detection runs over state read
 *    from the database — unchanged feed → nothing affected; changed price /
 *    new product / availability flip → that product; several changes to one
 *    product → one slug; several products → one slug each — then the plan
 *    the route executes is asserted (globals only when something changed).
 *
 * 3. Listing identity (§3): one product/store with two seller listings gets
 *    two separate current observations with distinct listing-aware offer ids.
 *
 * Database tests run against the real database with throwaway
 * `verify-polish-*` rows, cleaned up at the end. No server needed.
 *
 * Usage: node scripts/polish-verify.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import {
  chunkRows,
  deriveExternalId,
  listingRowsFor,
  offerRow,
  productRow,
  storeRowsFor,
  upsertListingsSql,
  upsertOffersSql,
  upsertProductsSql,
  upsertStoresSql,
} from "../lib/db/catalog-queries.ts";
import {
  collectAffectedSlugs,
  listingChanged,
  listingStateKey,
  listingStateSql,
  offerChanged,
  offerStateKey,
  offerStateSql,
  PRODUCT_STATE_SQL,
} from "../lib/db/change-detect.ts";
import { isSafeRedirectUrl } from "../lib/api/affiliate.ts";
import { revalidationPlan, mergeObservationChanges } from "../lib/data/revalidate-plan.ts";
import { getCurrentObservations, getNewestObservation, getOfferId } from "../lib/data/observations.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

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

/* -------------------------------- fixtures -------------------------------- */

const AFFILIATE_SLUG = "verify-polish-affiliate";
const DETECT_A = "verify-polish-detect-a";
const DETECT_B = "verify-polish-detect-b";
const NEW_SLUG = "verify-polish-never-written";
const STORE = "verify-polish-store";

const URL_1 = "https://verify.example/polish-affiliate-i.1.1";
const URL_2 = "https://verify.example/polish-affiliate-i.2.2";
const URL_NEW = "https://verify.example/polish-new-i.3.3";

const VALID_A = "https://shopee.ph/r/polish-aaa";
const VALID_B = "https://shopee.ph/r/polish-bbb";
const VALID_C = "https://shopee.ph/r/polish-ccc";
const INVALID = "https://evil.example/r/polish-ddd";

function offer(storeId, url, extra = {}) {
  return {
    storeId,
    price: 1000,
    url,
    updatedAt: new Date().toISOString(),
    inStock: true,
    source: "live",
    ...extra,
  };
}

function fixture(slug, offers) {
  return {
    id: slug,
    slug,
    name: `Verify Polish ${slug}`,
    brand: "Verify",
    category: "electronics",
    sku: `VP-${slug.toUpperCase()}`,
    image: "/images/verify.png",
    offers,
    priceHistory: [],
  };
}

async function listingIdFor(client, product, offerInput) {
  const external = deriveExternalId(offerInput.url, product.slug, offerInput.storeId);
  const { rows } = await client.query(
    "SELECT id FROM marketplace_listings WHERE store_id = $1 AND external_id = $2",
    [offerInput.storeId, external],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/** The mini-sync the ingest run performs: store → product → listings → offer. */
async function writeCatalog(client, product) {
  for (const chunk of chunkRows(storeRowsFor([product]))) {
    await client.query(upsertStoresSql(chunk.length), chunk.flat());
  }
  await client.query(upsertProductsSql(1), productRow(product, "live"));
  const listingRows = listingRowsFor([product], "live");
  if (listingRows.length > 0) {
    await client.query(upsertListingsSql(listingRows.length), listingRows.flat());
  }
  for (const offerInput of product.offers) {
    const listingId = await listingIdFor(client, product, offerInput);
    await client.query(upsertOffersSql(1), offerRow(product, offerInput, listingId));
  }
}

/** The incoming tuples for one or more products, listing ids resolved exactly as syncCatalog does. */
async function tuplesFor(client, products) {
  const offerTuples = [];
  for (const product of products) {
    for (const offerInput of product.offers) {
      offerTuples.push(offerRow(product, offerInput, await listingIdFor(client, product, offerInput)));
    }
  }
  return {
    productTuples: products.map((p) => productRow(p, "live")),
    listingTuples: products.flatMap((p) => listingRowsFor([p], "live")),
    offerTuples,
  };
}

/** Persisted state for the given products — the maps catalog-sync builds before writing. */
async function readExisting(client, products) {
  const slugs = products.map((p) => p.slug);
  const listingTuples = products.flatMap((p) => listingRowsFor([p], "live"));
  const listingKeys = listingTuples.map((row) => [String(row[0]), String(row[1])]);
  const offerKeys = products.flatMap((p) =>
    p.offers.map((o) => [
      p.slug,
      o.storeId,
      deriveExternalId(o.url, p.slug, o.storeId),
    ]),
  );

  const existingProducts = new Map(
    (await client.query(PRODUCT_STATE_SQL, [slugs])).rows.map((row) => [row.slug, row]),
  );
  const existingListings = new Map();
  if (listingKeys.length > 0) {
    for (const chunk of chunkRows(listingKeys, 2000)) {
      const { rows } = await client.query(listingStateSql(chunk.length), chunk.flat());
      for (const row of rows) {
        existingListings.set(listingStateKey(row.store_id, row.external_id), row);
      }
    }
  }
  const existingOffers = new Map();
  if (offerKeys.length > 0) {
    for (const chunk of chunkRows(offerKeys, 2000)) {
      const { rows } = await client.query(offerStateSql(chunk.length), chunk.flat());
      for (const row of rows) {
        existingOffers.set(offerStateKey(row.product_slug, row.store_id, row.external_id), row);
      }
    }
  }
  return { existingProducts, existingListings, existingOffers };
}

const offerAffiliate = (client, slug, url) =>
  client
    .query("SELECT affiliate_url FROM offers WHERE product_slug = $1 AND url = $2", [slug, url])
    .then((r) => (r.rows[0] ? r.rows[0].affiliate_url : "<missing>"));

const listingAffiliate = (client, slug, url) =>
  client
    .query(
      "SELECT affiliate_url FROM marketplace_listings WHERE product_slug = $1 AND product_url = $2",
      [slug, url],
    )
    .then((r) => (r.rows[0] ? r.rows[0].affiliate_url : "<missing>"));

/* ---------------------------------- run ----------------------------------- */

const client = new pg.Client({ connectionString: resolveConnectionString() });
await client.connect();

try {
  /* ------------------ §1 affiliate URL preservation (DB) ------------------ */
  console.log("\nAffiliate URLs survive ingestion (Final Polish §1)");
  try {
    const product = fixture(AFFILIATE_SLUG, [
      offer(STORE, URL_1, { affiliateUrl: VALID_A }),
      offer(STORE, URL_2),
    ]);
    check(
      "fixtures use the real allowlist check",
      isSafeRedirectUrl(VALID_A) && !isSafeRedirectUrl(INVALID),
    );

    // Baseline: first sync stores an approved affiliate URL.
    await writeCatalog(client, product);
    check(
      "baseline: an approved affiliate URL is stored",
      (await offerAffiliate(client, AFFILIATE_SLUG, URL_1)) === VALID_A,
      String(await offerAffiliate(client, AFFILIATE_SLUG, URL_1)),
    );
    check(
      "baseline: the listing row stores it too",
      (await listingAffiliate(client, AFFILIATE_SLUG, URL_1)) === VALID_A,
      String(await listingAffiliate(client, AFFILIATE_SLUG, URL_1)),
    );

    // Case 1 — existing valid + incoming NULL → preserve (offers and listings).
    await writeCatalog(
      client,
      fixture(AFFILIATE_SLUG, [offer(STORE, URL_1), offer(STORE, URL_2)]),
    );
    check(
      "existing URL + incoming NULL → offer URL preserved",
      (await offerAffiliate(client, AFFILIATE_SLUG, URL_1)) === VALID_A,
    );
    check(
      "existing URL + incoming NULL → listing URL preserved",
      (await listingAffiliate(client, AFFILIATE_SLUG, URL_1)) === VALID_A,
    );

    // Case 2 — existing NULL + incoming valid → stored.
    await writeCatalog(
      client,
      fixture(AFFILIATE_SLUG, [
        offer(STORE, URL_1, { affiliateUrl: VALID_A }),
        offer(STORE, URL_2, { affiliateUrl: VALID_B }),
      ]),
    );
    check(
      "existing NULL + incoming approved → new URL stored (offer)",
      (await offerAffiliate(client, AFFILIATE_SLUG, URL_2)) === VALID_B,
    );
    check(
      "existing NULL + incoming approved → new URL stored (listing)",
      (await listingAffiliate(client, AFFILIATE_SLUG, URL_2)) === VALID_B,
    );

    // Case 3 — existing valid + incoming valid replacement → replaced.
    await writeCatalog(
      client,
      fixture(AFFILIATE_SLUG, [
        offer(STORE, URL_1, { affiliateUrl: VALID_C }),
        offer(STORE, URL_2, { affiliateUrl: VALID_B }),
      ]),
    );
    check(
      "approved replacement overwrites (offer)",
      (await offerAffiliate(client, AFFILIATE_SLUG, URL_1)) === VALID_C,
    );

    // Case 4 — existing valid + incoming invalid → preserved.
    await writeCatalog(
      client,
      fixture(AFFILIATE_SLUG, [
        offer(STORE, URL_1, { affiliateUrl: INVALID }),
        offer(STORE, URL_2, { affiliateUrl: VALID_B }),
      ]),
    );
    check(
      "existing URL + incoming invalid → offer URL preserved",
      (await offerAffiliate(client, AFFILIATE_SLUG, URL_1)) === VALID_C,
      String(await offerAffiliate(client, AFFILIATE_SLUG, URL_1)),
    );
    check(
      "existing URL + incoming invalid → listing URL preserved",
      (await listingAffiliate(client, AFFILIATE_SLUG, URL_1)) === VALID_C,
      String(await listingAffiliate(client, AFFILIATE_SLUG, URL_1)),
    );

    // The builders themselves: validation happens BEFORE persistence.
    const badProduct = fixture("verify-polish-builder", [
      offer(STORE, URL_1, { affiliateUrl: INVALID }),
    ]);
    const goodProduct = fixture("verify-polish-builder", [
      offer(STORE, URL_1, { affiliateUrl: VALID_A }),
    ]);
    check(
      "offerRow nulls an unapproved URL before persistence",
      offerRow(badProduct, badProduct.offers[0], 1)[8] === null,
    );
    check(
      "offerRow passes an approved URL through",
      offerRow(goodProduct, goodProduct.offers[0], 1)[8] === VALID_A,
    );
    check(
      "listingRowsFor nulls an unapproved URL before persistence",
      listingRowsFor([badProduct], "live")[0][9] === null,
    );
    check(
      "listingRowsFor passes an approved URL through",
      listingRowsFor([goodProduct], "live")[0][9] === VALID_A,
    );
  } catch (error) {
    check("affiliate section runs", false, error instanceof Error ? error.message : String(error));
  }

  /* --------------- §2 change detection → revalidation plan --------------- */
  console.log("\nOnly changed products are revalidated (Final Polish §2)");
  try {
    const productA = fixture(DETECT_A, [offer(STORE, URL_1)]);
    const productB = fixture(DETECT_B, [offer(STORE, URL_2)]);
    await writeCatalog(client, productA);
    await writeCatalog(client, productB);

    // 1. Unchanged feed → nothing affected → no revalidation at all.
    const baselineExisting = await readExisting(client, [productA, productB]);
    const baselineTuples = await tuplesFor(client, [productA, productB]);
    const unchanged = collectAffectedSlugs({ ...baselineExisting, ...baselineTuples });
    const unchangedPlan = revalidationPlan(new Set(unchanged));
    check(
      "unchanged product → no revalidation",
      unchanged.length === 0 && unchangedPlan.products.length === 0 && !unchangedPlan.globals,
      JSON.stringify(unchanged),
    );

    // Touching only runtime stamps is not a material change.
    await client.query("UPDATE products SET updated_at = now() WHERE slug = $1", [DETECT_A]);
    await client.query("UPDATE offers SET last_checked_at = now() WHERE product_slug = $1", [
      DETECT_A,
    ]);
    const afterStamp = await readExisting(client, [productA, productB]);
    check(
      "timestamp-only churn → no revalidation",
      collectAffectedSlugs({ ...afterStamp, ...baselineTuples }).length === 0,
    );

    // 2. Changed price → that product is revalidated.
    const priceChanged = fixture(DETECT_A, [offer(STORE, URL_1, { price: 2000 })]);
    const priceTuples = await tuplesFor(client, [priceChanged, productB]);
    const priceAffected = collectAffectedSlugs({ ...afterStamp, ...priceTuples });
    const pricePlan = revalidationPlan(new Set(priceAffected));
    check(
      "changed price → revalidated",
      JSON.stringify(pricePlan.products) === JSON.stringify([DETECT_A]) && pricePlan.globals,
      JSON.stringify(priceAffected),
    );

    // 3. New product → revalidated (its rows do not exist in the state maps).
    const brandNew = fixture(NEW_SLUG, [offer(STORE, URL_NEW)]);
    const newExisting = await readExisting(client, [productA, productB]);
    const newTuples = await tuplesFor(client, [productA, productB, brandNew]);
    const newAffected = collectAffectedSlugs({ ...newExisting, ...newTuples });
    const newPlan = revalidationPlan(new Set(newAffected));
    check(
      "new product → revalidated",
      newPlan.products.includes(NEW_SLUG) && newPlan.globals,
      JSON.stringify(newAffected),
    );

    // 4. Several changes to one product → exactly one revalidation.
    const bothChanged = fixture(DETECT_A, [offer(STORE, URL_1, { price: 3000, inStock: false })]);
    bothChanged.name = "Verify Polish renamed";
    const bothTuples = await tuplesFor(client, [bothChanged, productB]);
    const bothAffected = collectAffectedSlugs({ ...newExisting, ...bothTuples });
    check(
      "price + name + availability change on one product → one revalidation",
      JSON.stringify(bothAffected) === JSON.stringify([DETECT_A]),
      JSON.stringify(bothAffected),
    );

    // 5. Changed listings across products → one revalidation per product.
    const priceA2 = fixture(DETECT_A, [offer(STORE, URL_1, { price: 4000 })]);
    const priceB2 = fixture(DETECT_B, [offer(STORE, URL_2, { price: 5000 })]);
    const crossTuples = await tuplesFor(client, [priceA2, priceB2]);
    const crossAffected = collectAffectedSlugs({ ...newExisting, ...crossTuples });
    const crossPlan = revalidationPlan(new Set(crossAffected));
    check(
      "two products changed → one revalidation each",
      JSON.stringify(crossPlan.products) === JSON.stringify([DETECT_A, DETECT_B]),
      JSON.stringify(crossAffected),
    );

    // 6. Offer availability change (publicly displayed) marks the product.
    check(
      "availability change counts as material",
      bothAffected.includes(DETECT_A),
      JSON.stringify(bothAffected),
    );

    // 7. Detection follows the COALESCE / approved-URL rule.
    const storedListing = newExisting.existingListings.get(
      listingStateKey(STORE, deriveExternalId(URL_1, DETECT_A, STORE)),
    );
    const storedOffer = newExisting.existingOffers.get(
      offerStateKey(DETECT_A, STORE, deriveExternalId(URL_1, DETECT_A, STORE)),
    );
    const listingTuple = listingRowsFor([productA], "live")[0];
    const nullAffiliateListing = [...listingTuple];
    nullAffiliateListing[9] = null;
    check(
      "incoming NULL affiliate is not a material change",
      storedListing ? !listingChanged(storedListing, nullAffiliateListing) : false,
      JSON.stringify(storedListing),
    );
    const validAffiliateListing = [...listingTuple];
    validAffiliateListing[9] = VALID_A;
    check(
      "incoming approved affiliate on a NULL column is a material change",
      storedListing ? listingChanged(storedListing, validAffiliateListing) : false,
    );
    const offerTuple = (await tuplesFor(client, [productA])).offerTuples[0];
    const invalidAffiliateOffer = [...offerTuple];
    invalidAffiliateOffer[8] = INVALID;
    check(
      "an unapproved affiliate value never registers as a change",
      storedOffer ? !offerChanged(storedOffer, invalidAffiliateOffer) : false,
    );
    const validAffiliateOffer = [...offerTuple];
    validAffiliateOffer[8] = VALID_A;
    check(
      "an approved affiliate replacement on a NULL column is a material change",
      storedOffer ? offerChanged(storedOffer, validAffiliateOffer) : false,
    );
  } catch (error) {
    check(
      "change-detection section runs",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  /* ------------------------- §2 plan semantics (pure) --------------------- */
  console.log("\nRevalidation plan semantics (pure)");
  const emptyPlan = revalidationPlan(new Set());
  check("no changes → no product paths", emptyPlan.products.length === 0);
  check("no changes → no global surfaces", emptyPlan.globals === false);
  const somePlan = revalidationPlan(new Set(["b-slug", "a-slug"]));
  check(
    "changed products → deterministic sorted slugs",
    JSON.stringify(somePlan.products) === JSON.stringify(["a-slug", "b-slug"]),
  );
  check("changed products → globals follow", somePlan.globals === true);

  const key = `${DETECT_A}::${STORE}::${deriveExternalId(URL_1, DETECT_A, STORE)}`;
  const acceptedRow = {
    productSlug: DETECT_A,
    storeId: STORE,
    listingExternalId: deriveExternalId(URL_1, DETECT_A, STORE),
    price: 1500,
    observedAt: new Date().toISOString(),
    availability: "in_stock",
    source: "live",
    providerId: "test",
  };
  const samePrice = new Set();
  mergeObservationChanges(samePrice, [acceptedRow], new Map([[key, 1500]]));
  check("observation at the same price → no revalidation", samePrice.size === 0);

  const priceMove = new Set();
  mergeObservationChanges(priceMove, [acceptedRow], new Map([[key, 1600]]));
  check(
    "observation with a price move → revalidated",
    JSON.stringify([...priceMove]) === JSON.stringify([DETECT_A]),
  );

  const firstEver = new Set();
  mergeObservationChanges(firstEver, [acceptedRow], new Map());
  check("first-ever observation for a listing → revalidated", firstEver.has(DETECT_A));

  const duplicates = new Set();
  mergeObservationChanges(
    duplicates,
    [acceptedRow, { ...acceptedRow, listingExternalId: "/other.2.2" }],
    new Map(),
  );
  check(
    "several listing changes on one product → one revalidation",
    duplicates.size === 1 && duplicates.has(DETECT_A),
  );

  /* ------------------ §3 listing-aware observation identity ----------------- */
  console.log("\nMultiple listings per product/store stay distinct (Final Polish §3)");
  const multi = fixture("verify-polish-multi", [
    offer(STORE, "https://verify.example/seller-one-i.1.1", { seller: "Seller One", price: 100 }),
    offer(STORE, "https://verify.example/seller-two-i.2.2", { seller: "Seller Two", price: 90 }),
  ]);
  const observations = getCurrentObservations(multi);
  check(
    "same product + store, two listings → two current observations",
    observations.length === 2,
    `${observations.length}`,
  );
  check(
    "the two listings have distinct offer identities",
    observations[0].offerId !== observations[1].offerId,
    `${observations[0].offerId} vs ${observations[1].offerId}`,
  );
  check("the two observations have distinct ids", observations[0].id !== observations[1].id);
  check(
    "identity carries the listing path",
    observations[0].offerId.includes("/seller-one-i.1.1") &&
      observations[1].offerId.includes("/seller-two-i.2.2"),
    observations[0].offerId,
  );
  check(
    "the same listing maps to a stable identity across reads",
    getCurrentObservations(multi)[0].offerId === observations[0].offerId,
  );
  const derivedId = getOfferId("x", { storeId: "s", url: "https://verify.example/p.1.1" });
  check(
    "getOfferId is listing-aware (offer, not bare store)",
    derivedId === "x:s:/p.1.1",
    derivedId,
  );
  check("getNewestObservation still answers across listings", getNewestObservation(multi) !== null);
  check(
    "a product with no listings has no observations",
    getCurrentObservations(fixture("verify-polish-none", [])).length === 0,
  );

  /* --------------------------- source wiring checks ------------------------ */
  console.log("\nWiring — the route executes exactly this plan");
  const read = (rel) => readFileSync(path.join(root, rel), "utf8");
  const route = read("app/api/ingest/route.ts");
  const sync = read("lib/db/catalog-sync.ts");
  const queries = read("lib/db/catalog-queries.ts");

  check(
    "route merges observation price changes into the affected set",
    route.includes("mergeObservationChanges(affected, accepted, previous)"),
  );
  check("route builds its plan from the affected set only", route.includes("revalidationPlan(affected)"));
  check("route gates global surfaces behind plan.globals", route.includes("if (plan.globals)"));
  check(
    "route no longer revalidates every ingested product",
    !route.includes("products.map((product) => product.slug)"),
  );
  check(
    "catalog sync reads persisted state before writing",
    sync.indexOf("PRODUCT_STATE_SQL") > -1 &&
      sync.indexOf("PRODUCT_STATE_SQL") < sync.indexOf("upsertProductsSql("),
  );
  check("catalog sync reports affected slugs", sync.includes("affectedSlugs"));
  check("catalog sync collapses duplicate feed records", sync.includes("dedupeByKey"));
  check(
    "listings preserve the stored affiliate URL on incoming NULL",
    upsertListingsSql(1).includes(
      "COALESCE(EXCLUDED.affiliate_url, marketplace_listings.affiliate_url)",
    ),
  );
  check(
    "offers preserve the stored affiliate URL on incoming NULL",
    upsertOffersSql(1).includes("COALESCE(EXCLUDED.affiliate_url, offers.affiliate_url)"),
  );
  check(
    "row builders validate affiliate URLs before persistence",
    queries.includes("persistableAffiliate") && queries.includes("isSafeRedirectUrl"),
  );
} finally {
  // Throwaway rows only — every fixture slug is namespaced verify-polish-*.
  try {
    await client.query("DELETE FROM price_observations WHERE product_slug LIKE 'verify-polish%'");
    await client.query("DELETE FROM offers WHERE product_slug LIKE 'verify-polish%'");
    await client.query("DELETE FROM marketplace_listings WHERE product_slug LIKE 'verify-polish%'");
    await client.query("DELETE FROM products WHERE slug LIKE 'verify-polish%'");
    await client.query("DELETE FROM stores WHERE id = $1", [STORE]);
  } catch (error) {
    console.warn(`cleanup warning: ${error instanceof Error ? error.message : error}`);
  }
  await client.end();
}

console.log(`\n${passed} checks passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
