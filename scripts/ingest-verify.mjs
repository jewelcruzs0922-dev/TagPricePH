#!/usr/bin/env node
/**
 * Phase 3 + Phase 18 verification: proves the ingestion contract refuses to
 * turn generated numbers into a price history, and that impossible readings
 * are screened out per row — using planIngestion() and screenRows() from
 * lib/data/ingest.ts and the same SQL the app writes with.
 *
 * Three halves:
 *  - the refusal rules, exercised purely (no provider that may report real
 *    prices exists yet, so this is where the guard is proven);
 *  - the Phase 18 row screening (non-positive, future, duplicate, and
 *    implausible-move refusals) — also pure, so the exact shipped code is
 *    what runs;
 *  - a write/read round trip against Neon for the batches an authorized
 *    provider would be allowed to send, including the mixed-source batch that
 *    must taint its series.
 *
 * Inserts under throwaway slugs and deletes them again, so the database is
 * left clean.
 *
 * Usage: node scripts/ingest-verify.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { toCents } from "../lib/db/money.ts";
import { MAX_PLAUSIBLE_CHANGE, planIngestion, rowKey, screenRows } from "../lib/data/ingest.ts";
import {
  INSERT_OBSERVATIONS_SQL,
  PRODUCT_SERIES_SQL,
} from "../lib/db/observation-queries.ts";

const { Client } = pg;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const DEMO_PROVIDER = { id: "demo", source: "demo" };
const AUTHORIZED_PROVIDER = { id: "acme-prices", source: "live" };

const LIVE_SLUG = "__verify-ingest-live__";
const MIXED_SLUG = "__verify-ingest-mixed__";

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

function day(offset) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString();
}

function offer(storeId, price, source, observedAt) {
  return {
    storeId,
    price,
    source,
    inStock: true,
    updatedAt: observedAt,
    url: `https://www.${storeId === "shopee" ? "shopee.ph" : `${storeId}.example`}/item/${price}`,
  };
}

function product(slug, offers) {
  return { slug, offers, priceHistory: [] };
}

/** Mirrors recordObservations() parameter mapping. */
function insertRows(client, rows) {
  return client.query(INSERT_OBSERVATIONS_SQL, [
    rows.map((row) => row.productSlug),
    rows.map((row) => row.storeId),
    rows.map((row) => row.listingExternalId ?? ""),
    rows.map((row) => toCents(row.price)),
    rows.map((row) => row.availability),
    rows.map((row) => row.source),
    rows.map((row) => row.observedAt),
    rows.map((row) => row.providerId),
  ]);
}

async function main() {
  const client = new Client({ connectionString: resolveConnectionString() });
  await client.connect();

  try {
    await client.query("DELETE FROM price_observations WHERE product_slug IN ($1, $2)", [
      LIVE_SLUG,
      MIXED_SLUG,
    ]);

    console.log("\nAuthorization");
    const demoProduct = product("__verify-ingest-demo__", [
      offer("shopee", 44990, "demo", day(0)),
      offer("lazada", 44490, "demo", day(0)),
    ]);
    const refused = planIngestion(DEMO_PROVIDER, demoProduct);
    check(
      "a provider that may not report real prices is refused",
      refused.authorized === false && refused.reason.includes("not authorized"),
      JSON.stringify(refused),
    );

    const relabeled = product("__verify-ingest-faked__", [
      offer("shopee", 44990, "live", day(0)),
      offer("lazada", 44490, "live", day(0)),
    ]);
    const faked = planIngestion(DEMO_PROVIDER, relabeled);
    check(
      "offers claiming source:\"live\" do not authorize an unauthorized provider",
      faked.authorized === false,
      JSON.stringify(faked),
    );

    const liveProduct = product(LIVE_SLUG, [
      offer("shopee", 44990, "live", day(1)),
      offer("lazada", 44490, "live", day(1)),
    ]);
    const allowed = planIngestion(AUTHORIZED_PROVIDER, liveProduct);
    check(
      "an authorized provider's batch is planned",
      allowed.authorized === true && allowed.rows.length === 2,
      JSON.stringify(allowed),
    );

    const mixedProduct = product(MIXED_SLUG, [
      offer("shopee", 44990, "live", day(0)),
      offer("lazada", 44490, "demo", day(0)),
    ]);
    const mixed = planIngestion(AUTHORIZED_PROVIDER, mixedProduct);
    check(
      "an unverified offer keeps source \"demo\" even from an authorized provider",
      mixed.authorized === true && mixed.rows[1].source === "demo",
      JSON.stringify(mixed),
    );

    check(
      "every planned row carries its provider as provenance",
      allowed.authorized === true &&
        allowed.rows.every((row) => row.providerId === AUTHORIZED_PROVIDER.id),
      JSON.stringify(allowed.authorized ? allowed.rows : allowed),
    );

    check(
      "every planned row carries its listing identity (derived from the URL)",
      allowed.authorized === true &&
        allowed.rows.every(
          (row) => typeof row.listingExternalId === "string" && row.listingExternalId.length > 0,
        ),
      JSON.stringify(allowed.authorized ? allowed.rows : allowed),
    );

    const undated = product("__verify-ingest-undated__", [
      offer("shopee", 44990, "live", "not-a-timestamp"),
    ]);
    const badTime = planIngestion(AUTHORIZED_PROVIDER, undated);
    check(
      "an unreadable observation time is refused instead of guessed",
      badTime.authorized === false && badTime.reason.includes("unreadable observation time"),
      JSON.stringify(badTime),
    );

    console.log("\nRow screening (Phase 18)");
    check(
      "plausibility limit is 85% (decimal/currency errors, real sales allowed)",
      MAX_PLAUSIBLE_CHANGE === 0.85,
      String(MAX_PLAUSIBLE_CHANGE),
    );

    const base = {
      productSlug: "__verify-screen__",
      storeId: "shopee",
      listingExternalId: "/item/45990",
      price: 45990,
      observedAt: day(1),
      availability: "in_stock",
      source: "live",
      providerId: AUTHORIZED_PROVIDER.id,
    };
    const row = (overrides) => ({ ...base, ...overrides });
    const none = new Map();

    const plain = screenRows([row({ price: 45990 }), row({ storeId: "lazada", price: 44990 })], none);
    check(
      "a clean batch passes screening untouched",
      plain.accepted.length === 2 && plain.rejected.length === 0,
      JSON.stringify(plain.rejected),
    );

    const nonPositive = screenRows([row({ price: 0 }), row({ price: -500 })], none);
    check(
      "non-positive prices are refused",
      nonPositive.accepted.length === 0 &&
        nonPositive.rejected.every((r) => r.reason.includes("not a positive")),
      JSON.stringify(nonPositive.rejected),
    );

    const future = screenRows(
      [row({ observedAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() })],
      none,
    );
    check(
      "a future observation time is refused",
      future.accepted.length === 0 && future.rejected[0]?.reason.includes("future"),
      JSON.stringify(future.rejected),
    );

    const duplicated = screenRows([row({ price: 45990 }), row({ price: 45990 })], none);
    check(
      "a duplicate row in the same batch is refused once",
      duplicated.accepted.length === 1 &&
        duplicated.rejected[0]?.reason.includes("duplicate"),
      JSON.stringify(duplicated.rejected),
    );

    const previous = new Map([
      [rowKey("__verify-screen__", "shopee", "/item/45990"), 45990],
    ]);
    const droppedZero = screenRows([row({ price: 4599 })], previous);
    check(
      "a dropped-zero move (-90%) is refused as implausible",
      droppedZero.accepted.length === 0 &&
        droppedZero.rejected[0]?.reason.includes("down 90%"),
      JSON.stringify(droppedZero.rejected),
    );

    const currencySlip = screenRows([row({ price: 459900 })], previous);
    check(
      "an unconverted-currency move (+900%) is refused as implausible",
      currencySlip.accepted.length === 0 &&
        currencySlip.rejected[0]?.reason.includes("up 900%"),
      JSON.stringify(currencySlip.rejected),
    );

    const flashSale = screenRows([row({ price: 14990 })], previous);
    check(
      "an aggressive but real sale (-67%) still passes",
      flashSale.accepted.length === 1 && flashSale.rejected.length === 0,
      JSON.stringify(flashSale.rejected),
    );

    const mixedBatch = screenRows(
      [row({ price: 44990 }), row({ price: 4599 })],
      previous,
    );
    check(
      "one bad row never blocks the good rows beside it",
      mixedBatch.accepted.length === 1 &&
        mixedBatch.accepted[0].price === 44990 &&
        mixedBatch.rejected.length === 1,
      JSON.stringify(mixedBatch),
    );

    console.log("\nListing-scoped screening (Live Data Readiness §4)");
    const prevA = new Map([[rowKey("__verify-screen__", "shopee", "/seller-a"), 100000]]);
    const bFirst = screenRows(
      [row({ listingExternalId: "/seller-b", price: 10000 })],
      prevA,
    );
    check(
      "Seller B's first reading passes — it is not judged against Seller A's history",
      bFirst.accepted.length === 1 && bFirst.rejected.length === 0,
      JSON.stringify(bFirst.rejected),
    );
    const aJump = screenRows(
      [row({ listingExternalId: "/seller-a", price: 10000 })],
      prevA,
    );
    check(
      "Seller A's own 90% move is still refused",
      aJump.accepted.length === 0 && aJump.rejected[0]?.reason.includes("down 90%"),
      JSON.stringify(aJump.rejected),
    );
    const instant = new Date().toISOString();
    const twoSellers = screenRows(
      [
        row({ listingExternalId: "/seller-a", price: 40000, observedAt: instant }),
        row({ listingExternalId: "/seller-b", price: 38000, observedAt: instant }),
      ],
      none,
    );
    check(
      "two sellers at one instant are not batch-duplicates of each other",
      twoSellers.accepted.length === 2 && twoSellers.rejected.length === 0,
      JSON.stringify(twoSellers.rejected),
    );

    console.log("\nSample catalog");
    const catalog = readFileSync(path.join(root, "lib/data/products.ts"), "utf8");
    check(
      "the sample catalog never claims source:\"live\"",
      !catalog.includes('source: "live"'),
      "found a live claim in lib/data/products.ts",
    );

    console.log("\nWrite path (authorized batches only)");
    if (!allowed.authorized || !mixed.authorized) {
      check("authorized batches available to write", false, "planning failed");
    } else {
      await insertRows(client, allowed.rows);
      await insertRows(client, mixed.rows);

      const { rows: written } = await client.query(
        "SELECT product_slug, source, count(*)::int AS n FROM price_observations WHERE product_slug IN ($1, $2) GROUP BY product_slug, source ORDER BY product_slug, source",
        [LIVE_SLUG, MIXED_SLUG],
      );
      const liveCount = written
        .filter((row) => row.product_slug === LIVE_SLUG)
        .reduce((sum, row) => sum + row.n, 0);
      const mixedLive = written.find(
        (row) => row.product_slug === MIXED_SLUG && row.source === "live",
      );
      const mixedDemo = written.find(
        (row) => row.product_slug === MIXED_SLUG && row.source === "demo",
      );
      check(
        "the all-live batch is written with its offer sources",
        liveCount === 2 && written.some((row) => row.product_slug === LIVE_SLUG && row.source === "live"),
        JSON.stringify(written),
      );
      check(
        "the mixed batch keeps both sources side by side",
        mixedLive?.n === 1 && mixedDemo?.n === 1,
        JSON.stringify(written),
      );

      console.log("\nRead path");
      const { rows: liveSeries } = await client.query(PRODUCT_SERIES_SQL, [LIVE_SLUG, true]);
      const { rows: mixedSeries } = await client.query(PRODUCT_SERIES_SQL, [MIXED_SLUG, true]);

      check(
        "an all-live batch yields a series that stays live",
        liveSeries.length === 1 && liveSeries[0].all_live === true,
        JSON.stringify(liveSeries),
      );
      check(
        "one unverified offer taints its whole day",
        mixedSeries.length === 1 && mixedSeries[0].all_live === false,
        JSON.stringify(mixedSeries),
      );
      const seriesSource = (rows) => (rows.every((row) => row.all_live) ? "live" : "demo");
      check(
        "getProductSeries would label the mixed series \"demo\"",
        seriesSource(liveSeries) === "live" && seriesSource(mixedSeries) === "demo",
      );
    }

    console.log("\nCleanup");
    await client.query("DELETE FROM price_observations WHERE product_slug IN ($1, $2)", [
      LIVE_SLUG,
      MIXED_SLUG,
    ]);
    const { rows: leftover } = await client.query(
      "SELECT count(*)::int AS n FROM price_observations WHERE product_slug IN ($1, $2)",
      [LIVE_SLUG, MIXED_SLUG],
    );
    check("test rows removed", leftover[0].n === 0, `${leftover[0].n} remaining`);

    const { rows: total } = await client.query(
      "SELECT count(*)::int AS n FROM price_observations",
    );
    console.log(`  INFO  price_observations now holds ${total[0].n} row(s)`);
  } finally {
    await client.end();
  }

  console.log(`\n${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nIngestion verification failed: ${error.message}`);
  process.exit(1);
});
