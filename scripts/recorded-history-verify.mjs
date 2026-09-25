#!/usr/bin/env node
/**
 * Phase 5 verification: proves the claim the whole observation store rests on
 * — that recorded observations actually change what the built product page
 * renders — and that the honesty gates open for *history* without opening for
 * *offers*.
 *
 * Nothing else in the suite touches rendered output: obs/ingest verify the SQL,
 * trust-verify checks the demo state. This one writes a temporary live batch
 * for a real catalog product, rebuilds, inspects the HTML, then removes the
 * rows and rebuilds again so the tree is left exactly as it was.
 *
 * Two directions are asserted:
 *   - the chart drops "Sample history…" and the verdict drops "Sample verdict"
 *     once a recorded series exists, and the recorded numbers reach the SVG;
 *   - the page-level sample label and the JSON-LD offer omission stay put,
 *     because those key off the *offers*, which are still sample data.
 *
 * Usage: node scripts/recorded-history-verify.mjs   (runs `npm run build` twice)
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { toCents } from "../lib/db/money.ts";
import { INSERT_OBSERVATIONS_SQL } from "../lib/db/observation-queries.ts";

const { Client } = pg;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** A real catalog product, so generateStaticParams renders a page for it. */
const SLUG = "iphone-16-128gb";
const STORE = "shopee";
/** Distinct from every catalog price, so its presence in the SVG is unambiguous. */
const RECORDED_PRICE = 120000;
const DAYS = 30;

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

function build(step) {
  console.log(`\n  next build (${step})…`);
  const result = spawnSync("npm run build", {
    cwd: root,
    shell: true,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(result.stdout ?? "");
    console.error(result.stderr ?? "");
    throw new Error(`npm run build failed while ${step}`);
  }
}

function productHtml() {
  const file = path.join(root, ".next", "server", "app", "product", `${SLUG}.html`);
  if (!existsSync(file)) throw new Error(`built page not found: ${file}`);
  return readFileSync(file, "utf8");
}

async function main() {
  const client = new Client({ connectionString: resolveConnectionString() });
  await client.connect();

  const removeRows = () =>
    client.query("DELETE FROM price_observations WHERE product_slug = $1", [SLUG]);

  process.on("SIGINT", () => {
    console.error("\nInterrupted — removing the temporary observations…");
    removeRows()
      .catch(() => {})
      .finally(() => process.exit(130));
  });

  let htmlDuringRecording;
  let restoredHtml;

  try {
    // Leftovers from an interrupted run would silently invalidate every check.
    await removeRows();

    console.log("\nRecording");
    const rows = Array.from({ length: DAYS }, (_, index) => {
      const date = new Date();
      date.setUTCHours(12, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - index);
      return {
        slug: SLUG,
        store: STORE,
        price: RECORDED_PRICE,
        availability: "in_stock",
        source: "live",
        observedAt: date.toISOString(),
      };
    });

    await client.query(INSERT_OBSERVATIONS_SQL, [
      rows.map((row) => row.slug),
      rows.map((row) => row.store),
      rows.map((row) => toCents(row.price)),
      rows.map((row) => row.availability),
      rows.map((row) => row.source),
      rows.map((row) => row.observedAt),
    ]);

    const { rows: written } = await client.query(
      "SELECT count(*)::int AS n FROM price_observations WHERE product_slug = $1",
      [SLUG],
    );
    check(
      `${DAYS} live observations recorded for ${SLUG}`,
      written[0].n === DAYS,
      `expected ${DAYS}, got ${written[0].n}`,
    );

    build("with recorded history");

    console.log("\nRendered with a recorded series");
    htmlDuringRecording = productHtml();
    check(
      "the chart no longer labels its history as sample",
      !htmlDuringRecording.includes("Sample history for demonstration"),
    );
    check(
      "the buy-timing verdict no longer disclaims itself as sample",
      !htmlDuringRecording.includes("Sample verdict"),
    );
    check(
      "the recorded series reaches the rendered chart",
      htmlDuringRecording.includes("120k"),
      "expected the recorded price on the chart axis",
    );
    check(
      "the offers are still labelled as sample data",
      htmlDuringRecording.includes("Sample listing for demonstration") ||
        htmlDuringRecording.includes("not live prices"),
    );
    check(
      "structured data still publishes no offer, because the offers are sample",
      !htmlDuringRecording.includes("priceCurrency"),
    );
    check(
      "the meta description still leads with the sample qualifier",
      htmlDuringRecording.includes('<meta name="description" content="Sample data.'),
    );
  } finally {
    console.log("\nRestoring");
    await client.query("DELETE FROM price_observations WHERE product_slug = $1", [SLUG]);
    const { rows: after } = await client.query(
      "SELECT count(*)::int AS n FROM price_observations WHERE product_slug = $1",
      [SLUG],
    );
    check(
      `${SLUG} left with no recorded observations`,
      after[0].n === 0,
      `${after[0].n} rows left behind`,
    );
    await client.end();

    build("with the recording removed");

    restoredHtml = productHtml();
    check(
      "the sample history label comes back once the recording is gone",
      restoredHtml.includes("Sample history for demonstration"),
    );
    check(
      "the recorded price is gone from the chart",
      !restoredHtml.includes("120k"),
    );
    check(
      "the sample verdict qualifier comes back",
      restoredHtml.includes("Sample verdict"),
    );
  }

  console.log(`\n${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nRecorded-history verification failed: ${error.message}`);
  process.exit(1);
});
