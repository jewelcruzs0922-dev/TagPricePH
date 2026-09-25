#!/usr/bin/env node
/**
 * Backend §19/§18 verification: the catalog read model, made executable.
 *
 * Unit (pure imports, no server):
 *   - fail-closed provider selection covers every combination of
 *     demo-mode × DATA_PROVIDER (§18);
 *   - the shared row builders (seed and ingest write through the same ones)
 *     produce the exact column tuples the batch upserts expect, and listing
 *     rows collapse per (store, external id).
 *
 * Database (real rows in Neon):
 *   - the seeded catalog matches lib/data/products.ts count-for-count;
 *   - every offer links to a marketplace listing, and (store, external id)
 *     is unique — one URL is one listing (§8);
 *   - the demo series is exactly the static history, provider 'demo-seed'
 *     (§19 provenance);
 *   - assembled products are indistinguishable from the static catalog the
 *     demo serves — the same statements the DB provider runs, run directly;
 *   - the ingest sync's upsert statements are idempotent (§19).
 *
 * Live (real server, port 3996, NEXT_PUBLIC_DEMO_MODE=false DATA_PROVIDER=db):
 *   - search serves from the database — proven by renaming a row in the
 *     database and watching the rename appear, then restoring it;
 *   - with demo off and no DATA_PROVIDER, the page errors instead of
 *     falling back to sample data (§18 fail-closed).
 *
 * Usage: node scripts/catalog-verify.mjs   (expects `npm run build` to have run)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { products, getProductBySlug } from "../lib/data/products.ts";
import { selectActiveProviderId } from "../lib/api/active-provider.ts";
import {
  assembleProduct,
  chunkRows,
  deriveExternalId,
  listingRowsFor,
  OFFERS_FOR_SLUG_SQL,
  PRODUCT_BY_SLUG_SQL,
  offerRow,
  productRow,
  storeRowsFor,
  upsertListingsSql,
  upsertOffersSql,
  upsertProductsSql,
  upsertStoresSql,
} from "../lib/db/catalog-queries.ts";
import { PRODUCT_SERIES_SQL } from "../lib/db/observation-queries.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = 3996;
const FAIL_PORT = 3997;
const FIXTURE_SLUG = "verify-catalog-sync";
const PROBE_NAME = "DBVERIFY-PROBE iPhone 16 128gb";
const SAMPLE_SLUGS = ["iphone-16-128gb", "ps5-slim", "samsung-55-qled-4k"];

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** JSON with sorted keys, so object key order can never decide equality. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function canonical(product, id) {
  const copy = { ...product, id };
  copy.offers = [...product.offers]
    .sort((a, b) => a.storeId.localeCompare(b.storeId))
    // updatedAt is a runtime stamp (now − daysAgo): it differs between the
    // import-time static catalog and whatever the last seed run wrote, so it
    // is provenance, not content.
    .map((offer) => {
      const rest = { ...offer };
      delete rest.updatedAt;
      return rest;
    });
  // History is compared as prices; dates are seeded from "today" and the
  // separate length check below pins the shape, so a verify run crossing
  // midnight cannot fail on a date label alone.
  copy.priceHistory = product.priceHistory.map((point) => point.price);
  return JSON.stringify(stable(copy));
}

/* ---------------------------------- unit ---------------------------------- */

function unitChecks() {
  console.log("\nFail-closed provider selection (§18)");
  check(
    "demo mode on → demo, whatever DATA_PROVIDER says",
    selectActiveProviderId(true, undefined).ok &&
      selectActiveProviderId(true, undefined).id === "demo" &&
      selectActiveProviderId(true, "db").id === "demo",
  );
  const unset = selectActiveProviderId(false, undefined);
  check(
    "demo off + no DATA_PROVIDER → refused with a reason",
    !unset.ok && unset.error.includes("refusing to fall back"),
    unset.ok ? "ok" : unset.error,
  );
  const demo = selectActiveProviderId(false, "demo");
  check(
    "demo off + DATA_PROVIDER=demo → refused as a contradiction",
    !demo.ok && demo.error.includes("contradicts"),
    demo.ok ? "ok" : demo.error,
  );
  const db = selectActiveProviderId(false, "db");
  check("demo off + DATA_PROVIDER=db → db", db.ok && db.id === "db");
  const blank = selectActiveProviderId(false, "   ");
  check("whitespace DATA_PROVIDER is treated as unset", !blank.ok);

  console.log("\nRow builders (shared by seed and ingest)");
  const sample = products[0];
  const pRow = productRow(sample, "live");
  check("productRow is 14 columns", pRow.length === 14, String(pRow.length));
  check(
    "productRow takes its provenance from the caller, not the product",
    pRow[6] === "live" && productRow(sample, "demo")[6] === "demo",
  );

  const offers = offerRow(sample, sample.offers[0], 7);
  check("offerRow is 14 columns", offers.length === 14, String(offers.length));
  check(
    "offerRow links the listing id it is handed",
    offers[11] === 7,
    String(offers[11]),
  );
  check("offerRow carries no fabricated affiliate link", offers[8] === null);

  const shared = [
    { ...sample, slug: "a", name: "A", offers: sample.offers.map((o) => ({ ...o, storeId: "tiktok", url: "https://shop.tiktok.com/shop" })) },
    { ...sample, slug: "b", name: "B", offers: sample.offers.map((o) => ({ ...o, storeId: "tiktok", url: "https://shop.tiktok.com/shop" })) },
  ];
  const collapsed = listingRowsFor(shared, "live");
  check(
    "many offers on one URL collapse to one listing row",
    collapsed.length === 1,
    String(collapsed.length),
  );
  check(
    "listing rows are 9 columns with the derived external id",
    collapsed[0].length === 9 && collapsed[0][1] !== "",
    JSON.stringify(collapsed[0]?.slice(0, 2)),
  );

  const stores = storeRowsFor(shared);
  check(
    "store rows are the distinct offer stores",
    stores.length === new Set(shared.flatMap((p) => p.offers.map((o) => o.storeId))).size &&
      stores.every(([id, name]) => id === name),
    JSON.stringify(stores),
  );

  check(
    "external id comes from the URL path",
    deriveExternalId("https://shopee.ph/item/i.123.456", "s", "shopee") === "/item/i.123.456",
  );
  check(
    "a store-homepage link falls back to the slug:store surrogate",
    deriveExternalId("https://www.tiktok.com/shop", "s", "tiktok") === "/shop" &&
      deriveExternalId("https://www.tiktok.com", "s", "tiktok") === "s:tiktok",
  );
  check(
    "chunkRows stays under the parameter cap",
    chunkRows(Array.from({ length: 3500 }, (_, i) => i)).length === 3 &&
      chunkRows(Array.from({ length: 3500 }, (_, i) => i))[0].length === 1500,
  );
}

/* -------------------------------- database -------------------------------- */

async function databaseChecks(client) {
  console.log("\nSeeded catalog matches the static seed (§19)");
  const expectedOffers = products.reduce((sum, p) => sum + p.offers.length, 0);
  const expectedSeries = products.reduce((sum, p) => sum + p.priceHistory.length, 0);

  const counts = (await client.query(`
    SELECT (SELECT count(*) FROM products)::int                    AS products,
           (SELECT count(*) FROM offers)::int                      AS offers,
           (SELECT count(*) FROM price_observations
             WHERE provider_id = 'demo-seed')::int                 AS demo_series,
           (SELECT count(*) FROM price_observations
             WHERE provider_id = 'demo-seed' AND store_id <> 'demo')::int AS misattributed
  `)).rows[0];
  check(
    "one database row per static product",
    counts.products === products.length,
    `${counts.products} vs ${products.length}`,
  );
  check(
    "one database row per static offer",
    counts.offers === expectedOffers,
    `${counts.offers} vs ${expectedOffers}`,
  );
  check(
    "the demo series is exactly the static history",
    counts.demo_series === expectedSeries,
    `${counts.demo_series} vs ${expectedSeries}`,
  );
  check(
    "demo observations are attributed to the demo pseudo-store (§19)",
    counts.misattributed === 0,
    `${counts.misattributed} rows elsewhere`,
  );

  console.log("\nListing identity (§8)");
  const unlinked = (await client.query(
    "SELECT count(*)::int AS n FROM offers WHERE listing_id IS NULL",
  )).rows[0].n;
  check("every offer links to a marketplace listing", unlinked === 0, `${unlinked} unlinked`);

  const dupes = (await client.query(`
    SELECT count(*)::int AS n FROM (
      SELECT store_id, external_id FROM marketplace_listings
       GROUP BY store_id, external_id HAVING count(*) > 1
    ) d
  `)).rows[0].n;
  check("one listing per (store, external id)", dupes === 0, `${dupes} duplicated`);

  const sharedUrl = (await client.query(`
    SELECT (SELECT count(*) FROM marketplace_listings WHERE store_id = 'tiktok')::int AS listings,
           (SELECT count(*) FROM offers o JOIN marketplace_listings l ON l.id = o.listing_id
             WHERE o.store_id = 'tiktok')::int                                       AS linked
  `)).rows[0];
  check(
    "TikTok's single shared store page is one listing carrying many offers",
    sharedUrl.listings === 1 && sharedUrl.linked > 1,
    JSON.stringify(sharedUrl),
  );

  console.log("\nAssembly fidelity (the statements db-provider runs)");
  for (const slug of SAMPLE_SLUGS) {
    const staticProduct = getProductBySlug(slug);
    const [row] = (await client.query(PRODUCT_BY_SLUG_SQL, [slug])).rows;
    const offerRows = (await client.query(OFFERS_FOR_SLUG_SQL, [slug])).rows;
    const seriesRows = (await client.query(PRODUCT_SERIES_SQL, [slug])).rows;
    const assembled = row ? assembleProduct(row, offerRows, seriesRows) : null;

    check(`${slug} exists in both catalogs`, Boolean(staticProduct) && Boolean(assembled));
    if (!staticProduct || !assembled) continue;

    check(
      `${slug} assembles identically to the static catalog`,
      canonical(assembled, assembled.id) === canonical(staticProduct, assembled.id),
      canonical(assembled, assembled.id).slice(0, 200),
    );
    check(
      `${slug} keeps its history length in the database`,
      assembled.priceHistory.length === staticProduct.priceHistory.length,
      `${assembled.priceHistory.length} vs ${staticProduct.priceHistory.length}`,
    );
  }

  console.log("\nIngest sync statements are idempotent (§19)");
  try {
    const fixture = {
      id: FIXTURE_SLUG,
      slug: FIXTURE_SLUG,
      name: "Verify Catalog Sync",
      brand: "Verify",
      category: "electronics",
      sku: "VERIFY-SYNC-1",
      image: "/images/verify.png",
      offers: [
        {
          storeId: "shopee",
          price: 1234,
          url: "https://shopee.ph/verify-catalog-sync-i.9.9",
          updatedAt: new Date().toISOString(),
          inStock: true,
          source: "live",
        },
      ],
      priceHistory: [],
    };

    const writeOnce = async () => {
      await client.query("BEGIN");
      try {
        for (const chunk of chunkRows([["shopee", "Shopee"], ["demo", "Sample data"]])) {
          await client.query(upsertStoresSql(chunk.length), chunk.flat());
        }
        await client.query(upsertProductsSql(1), productRow(fixture, "live"));
        const listingRows = listingRowsFor([fixture], "live");
        await client.query(upsertListingsSql(listingRows.length), listingRows.flat());
        const pairs = listingRows.flatMap((row) => [row[0], row[1]]);
        const { rows: ids } = await client.query(
          "SELECT id, store_id, external_id FROM marketplace_listings WHERE (store_id, external_id) IN (VALUES ($1, $2))",
          pairs,
        );
        const listingId = ids.length > 0 ? Number(ids[0].id) : null;
        await client.query(upsertOffersSql(1), offerRow(fixture, fixture.offers[0], listingId));
        await client.query("COMMIT");
        return listingId;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    };

    const firstId = await writeOnce();
    const secondId = await writeOnce();
    const state = (await client.query(`
      SELECT (SELECT count(*) FROM products WHERE slug = $1)::int AS products,
             (SELECT count(*) FROM offers WHERE product_slug = $1)::int AS offers,
             (SELECT count(*) FROM marketplace_listings
               WHERE store_id = 'shopee' AND external_id LIKE '%verify-catalog-sync%')::int AS listings,
             (SELECT listing_id FROM offers WHERE product_slug = $1) AS linked
    `, [FIXTURE_SLUG])).rows[0];

    check("a sync write lands product, listing and offer", firstId !== null && secondId !== null);
    check(
      "re-running the sync does not duplicate anything",
      state.products === 1 && state.offers === 1 && state.listings === 1,
      JSON.stringify(state),
    );
    check(
      "the fixture offer is linked to its listing",
      state.linked !== null && Number(state.linked) === firstId,
      `${state.linked} vs ${firstId}`,
    );
  } finally {
    await client.query("DELETE FROM marketplace_listings WHERE external_id LIKE '%verify-catalog-sync%'");
    await client.query("DELETE FROM products WHERE slug = $1", [FIXTURE_SLUG]);
  }
}

/* ---------------------------------- http ---------------------------------- */

function startServer(port, extraEnv) {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
  });
  // Kept so a render failure can be asserted on its logged reason: a streamed
  // response can commit status 200 before the page body fails, so the status
  // code alone cannot prove the app refused to serve demo data.
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.readOutput = () => output;
  return child;
}

async function killServer(child) {
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 5_000);
  });
}

async function waitForServer(child, port) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(`http://localhost:${port}/`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.status === 200) return true;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  return false;
}

async function get(port, pathname) {
  const response = await fetch(`http://localhost:${port}${pathname}`, {
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, text: await response.text() };
}

async function httpChecks(client) {
  console.log("\nDB provider over HTTP (NEXT_PUBLIC_DEMO_MODE=false DATA_PROVIDER=db)");
  const server = startServer(APP_PORT, {
    NEXT_PUBLIC_DEMO_MODE: "false",
    DATA_PROVIDER: "db",
  });
  try {
    const up = await waitForServer(server, APP_PORT);
    check("server starts against the database", up, "next start never became ready");
    if (!up) return;

    const search = await get(APP_PORT, "/search?q=iphone");
    check(
      "search answers 200 from the seeded catalog",
      search.status === 200 && search.text.includes("iPhone 16"),
      `status ${search.status}`,
    );

    // The strongest available proof: rename the row in the database and watch
    // the rename come back over HTTP, then put it back.
    let sawProbe = false;
    let restored = false;
    try {
      await client.query(
        "UPDATE products SET name = $1 WHERE slug = 'iphone-16-128gb'",
        [PROBE_NAME],
      );
      const probe = await get(APP_PORT, "/search?q=DBVERIFY-PROBE");
      sawProbe = probe.status === 200 && probe.text.includes(PROBE_NAME);
    } finally {
      await client.query(
        "UPDATE products SET name = $1 WHERE slug = 'iphone-16-128gb'",
        ["iPhone 16 128GB"],
      );
      const after = await get(APP_PORT, "/search?q=DBVERIFY-PROBE");
      restored = after.status === 200 && !after.text.includes(PROBE_NAME);
    }
    check("served HTML reflects a database edit (reads come from the DB)", sawProbe);
    check("the probe row is restored afterwards", restored);
  } finally {
    await killServer(server);
  }

  console.log("\nFail-closed over HTTP (§18)");
  const failServer = startServer(FAIL_PORT, {
    NEXT_PUBLIC_DEMO_MODE: "false",
    DATA_PROVIDER: "",
  });
  try {
    const up = await waitForServer(failServer, FAIL_PORT);
    check("server starts in fail-closed mode", up, "next start never became ready");
    if (!up) return;
    const search = await get(FAIL_PORT, "/search?q=iphone");
    check(
      "demo off with no DATA_PROVIDER serves no catalog content",
      !search.text.includes("iPhone 16"),
      `status ${search.status}, products in HTML`,
    );
    const log = failServer.readOutput();
    check(
      "the page failed for the fail-closed reason, not something else",
      log.includes("refusing to fall back"),
      log.slice(-400).replace(/\s+/g, " "),
    );
  } finally {
    await killServer(failServer);
  }
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
  if (!existsSync(path.join(root, ".next"))) {
    console.error("No .next directory — run npm run build first.");
    process.exit(1);
  }

  unitChecks();

  const { Client } = pg;
  const envPath = path.join(root, ".env.local");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const client = new Client({ connectionString: resolveConnectionString() });
  await client.connect();
  try {
    await databaseChecks(client);
    await httpChecks(client);
  } finally {
    await client.end();
  }
}

await main();
console.log(`\n${passed}/${passed + failed} checks passed.\n`);
process.exit(failed === 0 ? 0 : 1);
