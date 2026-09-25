#!/usr/bin/env node
/**
 * Phase 3 verification: proves the ingestion contract refuses to turn
 * generated numbers into a price history, using planIngestion() from
 * lib/data/ingest.ts and the same SQL the app writes with.
 *
 * Two halves:
 *  - the refusal rules, exercised purely (no provider that may report real
 *    prices exists yet, so this is where the guard is proven);
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
import { planIngestion } from "../lib/data/ingest.ts";
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
  return { storeId, price, source, inStock: true, updatedAt: observedAt };
}

function product(slug, offers) {
  return { slug, offers, priceHistory: [] };
}

/** Mirrors recordObservations() parameter mapping. */
function insertRows(client, rows) {
  return client.query(INSERT_OBSERVATIONS_SQL, [
    rows.map((row) => row.productSlug),
    rows.map((row) => row.storeId),
    rows.map((row) => toCents(row.price)),
    rows.map((row) => row.availability),
    rows.map((row) => row.source),
    rows.map((row) => row.observedAt),
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

    const undated = product("__verify-ingest-undated__", [
      offer("shopee", 44990, "live", "not-a-timestamp"),
    ]);
    const badTime = planIngestion(AUTHORIZED_PROVIDER, undated);
    check(
      "an unreadable observation time is refused instead of guessed",
      badTime.authorized === false && badTime.reason.includes("unreadable observation time"),
      JSON.stringify(badTime),
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
      const { rows: liveSeries } = await client.query(PRODUCT_SERIES_SQL, [LIVE_SLUG]);
      const { rows: mixedSeries } = await client.query(PRODUCT_SERIES_SQL, [MIXED_SLUG]);

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
