#!/usr/bin/env node
/**
 * Phase 2 verification: proves the observation store behaves as designed
 * against a real database — using the *same* SQL the app runs, imported
 * straight from lib/db/observation-queries.ts so there is no second copy of
 * these statements to drift.
 *
 * Covers the write path (batch append, centavos, append-only), the read path
 * (daily minimum, ascending order, source honesty, demo exclusion for live
 * products), LISTING identity (Live Data Readiness §3) and listing-scoped
 * previous prices (§4), plus the CHECK constraints and the read index.
 *
 * Inserts test rows under throwaway product slugs and deletes them again, so
 * the database is left clean.
 *
 * Usage: node scripts/observations-verify.mjs
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { toCents } from "../lib/db/money.ts";
import {
  INSERT_OBSERVATIONS_SQL,
  LAST_PRICES_SQL,
  PRODUCT_SERIES_FOR_SLUGS_SQL,
  PRODUCT_SERIES_SQL,
} from "../lib/db/observation-queries.ts";

const { Client } = pg;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** Throwaway slugs — never collide with a real catalog product. */
const ALL_LIVE = "__verify-obs-live__";
const MIXED = "__verify-obs-mixed__";
const DEMO_ONLY = "__verify-obs-demo__";
const IDENTITY = "__verify-obs-identity__";
const LAST = "__verify-obs-last__";
const THROWAWAY = [ALL_LIVE, MIXED, DEMO_ONLY, IDENTITY, LAST];

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

async function expectRejected(client, label, sql, params) {
  try {
    await client.query(sql, params);
    check(label, false, "statement succeeded but should have been rejected");
  } catch (error) {
    check(label, true, error.constraint ? `constraint: ${error.constraint}` : "rejected");
  }
}

/** Mimics lib/db/observations.ts → recordObservations() parameter mapping. */
async function record(client, rows) {
  await client.query(INSERT_OBSERVATIONS_SQL, [
    rows.map((row) => row.productSlug),
    rows.map((row) => row.storeId),
    rows.map((row) => row.listingExternalId ?? ""),
    rows.map((row) => toCents(row.price)),
    rows.map((row) => row.availability ?? "in_stock"),
    rows.map((row) => row.source),
    rows.map((row) => row.observedAt),
    rows.map((row) => row.providerId),
  ]);
}

function day(offset) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString();
}

async function countFor(client, slugs) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM price_observations WHERE product_slug = ANY($1::text[])",
    [slugs],
  );
  return rows[0].n;
}

async function main() {
  const client = new Client({ connectionString: resolveConnectionString() });
  await client.connect();

  try {
    // Always start from a clean slate in case a previous run was interrupted.
    await client.query("DELETE FROM price_observations WHERE product_slug = ANY($1::text[])", [
      THROWAWAY,
    ]);

    console.log("\nWrite path");
    await record(client, [
      // Two stores, same day → one point at the lower price.
      { productSlug: ALL_LIVE, storeId: "shopee", price: 45000, observedAt: day(2), source: "live", providerId: "verify-script" },
      { productSlug: ALL_LIVE, storeId: "lazada", price: 44500, observedAt: day(2), source: "live", providerId: "verify-script" },
      { productSlug: ALL_LIVE, storeId: "shopee", price: 44000, observedAt: day(1), source: "live", providerId: "verify-script" },
      { productSlug: ALL_LIVE, storeId: "tiktok", price: 43800, observedAt: day(1), source: "live", providerId: "verify-script" },
      { productSlug: ALL_LIVE, storeId: "shopee", price: 44200, observedAt: day(0), source: "live", providerId: "verify-script" },
      // One generated reading among real ones — must taint its day.
      { productSlug: MIXED, storeId: "shopee", price: 500, observedAt: day(1), source: "live", providerId: "verify-script" },
      { productSlug: MIXED, storeId: "lazada", price: 495, observedAt: day(1), source: "demo", providerId: "verify-script" },
      // A product whose history is entirely generated.
      { productSlug: DEMO_ONLY, storeId: "shopee", price: 999, observedAt: day(0), source: "demo", providerId: "verify-script" },
    ]);

    const written = await countFor(client, THROWAWAY);
    check(
      "every reading in the batch is appended, none overwritten",
      written === 8,
      `expected 8 rows, got ${written}`,
    );

    const { rows: cents } = await client.query(
      "SELECT price_cents FROM price_observations WHERE product_slug = $1 ORDER BY id LIMIT 1",
      [ALL_LIVE],
    );
    check(
      "prices are stored as integer centavos",
      cents[0].price_cents === toCents(45000) && Number.isInteger(cents[0].price_cents),
      `got ${cents[0].price_cents}`,
    );

    console.log("\nRead path (PRODUCT_SERIES_SQL)");
    const { rows: series } = await client.query(PRODUCT_SERIES_SQL, [ALL_LIVE, true]);

    check(
      "one point per calendar day",
      series.length === 3,
      `expected 3 points, got ${series.length}`,
    );
    check(
      "a day's point is the lowest price seen across stores that day",
      series[0]?.price_cents === toCents(44500) &&
        series[1]?.price_cents === toCents(43800) &&
        series[2]?.price_cents === toCents(44200),
      JSON.stringify(series.map((row) => row.price_cents)),
    );
    check(
      "points come back in ascending date order",
      series.every(
        (row, index) => index === 0 || row.date > series[index - 1].date,
      ),
      JSON.stringify(series.map((row) => row.date)),
    );
    check(
      "a series of only live readings reports all_live on every day",
      series.every((row) => row.all_live === true),
    );

    const { rows: mixed } = await client.query(PRODUCT_SERIES_SQL, [MIXED, true]);
    check(
      "one demo reading makes that day's all_live false",
      mixed.length === 1 && mixed[0].all_live === false,
      JSON.stringify(mixed),
    );
    check(
      "the mixed day still resolves to the lowest price seen",
      mixed[0]?.price_cents === toCents(495),
      `got ${mixed[0]?.price_cents}`,
    );

    console.log("\nDemo/live separation (Live Data Readiness §5)");
    const { rows: liveMixed } = await client.query(PRODUCT_SERIES_SQL, [MIXED, false]);
    check(
      "a live product never reads the demo row beside its live ones",
      liveMixed.length === 1 && liveMixed[0].all_live === true,
      JSON.stringify(liveMixed),
    );
    const { rows: liveDemoOnly } = await client.query(PRODUCT_SERIES_SQL, [DEMO_ONLY, false]);
    check(
      "a live product whose history is all demo gets NO history, not demo history",
      liveDemoOnly.length === 0,
      JSON.stringify(liveDemoOnly),
    );
    const { rows: demoAllowed } = await client.query(PRODUCT_SERIES_SQL, [DEMO_ONLY, true]);
    check(
      "a demo product still reads its own demo history",
      demoAllowed.length === 1 && demoAllowed[0].all_live === false,
      JSON.stringify(demoAllowed),
    );

    console.log("\nBatch read (PRODUCT_SERIES_FOR_SLUGS_SQL)");
    const absent = "__verify-obs-absent__";
    const { rows: batch } = await client.query(PRODUCT_SERIES_FOR_SLUGS_SQL, [
      [ALL_LIVE, MIXED, DEMO_ONLY, absent],
      [ALL_LIVE, MIXED],
    ]);
    const batchLive = batch.filter((row) => row.product_slug === ALL_LIVE);
    const batchMixed = batch.filter((row) => row.product_slug === MIXED);
    check(
      "one query returns every requested slug that has history",
      batchLive.length === 3 && batchMixed.length === 1,
      JSON.stringify(batch),
    );
    check(
      "a slug with no history contributes no rows",
      !batch.some((row) => row.product_slug === absent),
    );
    check(
      "a demo-only slug outside the allowlist contributes no rows either",
      !batch.some((row) => row.product_slug === DEMO_ONLY),
      JSON.stringify(batch),
    );
    check(
      "points stay grouped and ascending within each slug",
      batchLive.every((row, index) => index === 0 || row.date > batchLive[index - 1].date),
      JSON.stringify(batchLive.map((row) => row.date)),
    );
    check(
      "all_live survives the batch aggregation",
      batchLive.every((row) => row.all_live === true) && batchMixed[0]?.all_live === false,
      JSON.stringify(batch),
    );
    check(
      "the batch matches the single-slug read exactly",
      JSON.stringify(batchLive.map((row) => [row.date, row.price_cents, row.all_live])) ===
        JSON.stringify(series.map((row) => [row.date, row.price_cents, row.all_live])),
    );

    console.log("\nListing identity (Live Data Readiness §3)");
    const sellers = ["/seller-a", "/seller-b", "/seller-c"];
    const sameInstant = day(0);
    await record(
      client,
      sellers.map((listingExternalId) => ({
        productSlug: IDENTITY,
        storeId: "shopee",
        listingExternalId,
        price: 40000 + sellers.indexOf(listingExternalId),
        observedAt: sameInstant,
        source: "live",
        providerId: "verify-script",
      })),
    );
    const identityRows = await countFor(client, [IDENTITY]);
    check(
      "three sellers of one product at one instant are three observations",
      identityRows === 3,
      `expected 3 rows, got ${identityRows}`,
    );

    await record(
      client,
      sellers.map((listingExternalId) => ({
        productSlug: IDENTITY,
        storeId: "shopee",
        listingExternalId,
        price: 40000 + sellers.indexOf(listingExternalId),
        observedAt: sameInstant,
        source: "live",
        providerId: "verify-script",
      })),
    );
    const retried = await countFor(client, [IDENTITY]);
    check(
      "re-recording the same batch writes nothing new (idempotent per listing)",
      retried === 3,
      `expected 3 rows, got ${retried}`,
    );

    await record(client, [
      { productSlug: IDENTITY, storeId: "shopee", listingExternalId: "/seller-a", price: 1, observedAt: sameInstant, source: "live", providerId: "verify-script" },
      { productSlug: IDENTITY, storeId: "shopee", listingExternalId: "/seller-a", price: 2, observedAt: sameInstant, source: "live", providerId: "verify-script" },
    ]);
    const deduped = await countFor(client, [IDENTITY]);
    check(
      "the same listing at the same instant collapses to one row",
      deduped === 3,
      `expected 3 rows, got ${deduped}`,
    );

    console.log("\nListing-scoped previous prices (Live Data Readiness §4)");
    await record(client, [
      { productSlug: LAST, storeId: "shopee", listingExternalId: "/seller-a", price: 100000, observedAt: day(1), source: "live", providerId: "verify-script" },
      { productSlug: LAST, storeId: "shopee", listingExternalId: "/seller-a", price: 95000, observedAt: day(0), source: "live", providerId: "verify-script" },
      { productSlug: LAST, storeId: "shopee", listingExternalId: "/seller-b", price: 20000, observedAt: day(0), source: "live", providerId: "verify-script" },
    ]);
    const { rows: last } = await client.query(LAST_PRICES_SQL, [
      [`${LAST}::shopee::/seller-a`, `${LAST}::shopee::/seller-b`],
    ]);
    const byKey = Object.fromEntries(last.map((row) => [row.key, row.price_cents]));
    check(
      "each listing answers with its OWN last price, newest first",
      byKey[`${LAST}::shopee::/seller-a`] === toCents(95000),
      JSON.stringify(byKey),
    );
    check(
      "a second seller is not judged against the first seller's history",
      byKey[`${LAST}::shopee::/seller-b`] === toCents(20000),
      JSON.stringify(byKey),
    );
    check(
      "no key mixes listings together",
      last.length === 2,
      JSON.stringify(last),
    );

    console.log("\nConstraints");
    await expectRejected(
      client,
      "a zero price is rejected",
      INSERT_OBSERVATIONS_SQL,
      [[ALL_LIVE], ["shopee"], [""], [0], ["in_stock"], ["live"], [day(0)], ["verify-script"]],
    );
    await expectRejected(
      client,
      "an unknown source is rejected",
      INSERT_OBSERVATIONS_SQL,
      [[ALL_LIVE], ["shopee"], [""], [100], ["in_stock"], ["bogus"], [day(0)], ["verify-script"]],
    );
    await expectRejected(
      client,
      "an unknown availability is rejected",
      INSERT_OBSERVATIONS_SQL,
      [[ALL_LIVE], ["shopee"], [""], [100], ["maybe"], ["live"], [day(0)], ["verify-script"]],
    );

    console.log("\nRead index");
    const { rows: indexes } = await client.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'price_observations'",
    );
    const names = indexes.map((row) => row.indexname);
    check(
      "price_observations_offer_idx exists for the history read",
      names.includes("price_observations_offer_idx"),
      names.join(", "),
    );
    check(
      "the idempotency index carries the listing (migration 0013)",
      names.includes("price_observations_idempotency_idx"),
      names.join(", "),
    );

    console.log("\nHonesty");
    const { rows: catalogRows } = await client.query(
      "SELECT count(*)::int AS n FROM price_observations WHERE product_slug = $1",
      ["iphone-16-128gb"],
    );
    console.log(
      `  INFO  observations recorded for iphone-16-128gb: ${catalogRows[0].n}` +
        " (stays 0 until a provider that may report real prices is connected)",
    );

    console.log("\nCleanup");
    const { rows: removed } = await client.query(
      "DELETE FROM price_observations WHERE product_slug = ANY($1::text[]) RETURNING id",
      [THROWAWAY],
    );
    const leftover = await countFor(client, THROWAWAY);
    check(
      "test rows removed and none left behind",
      leftover === 0,
      `${removed.length} deleted, ${leftover} remaining`,
    );

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
  console.error(`\nObservation verification failed: ${error.message}`);
  process.exit(1);
});
