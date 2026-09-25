#!/usr/bin/env node
/**
 * Phase 10 verification: the anonymous product-view event.
 *
 * Two halves, mirroring the other suites:
 *   - validation, imported straight from lib/data/view-events.ts, so the rules
 *     the public endpoint enforces are checked without booting a server;
 *   - a real write through INSERT_VIEW_SQL and a read back, so the schema and
 *     the statement are proved against Postgres rather than by inspection.
 *
 * Rows are deleted again; the table is left as it was.
 *
 * Usage: node scripts/views-verify.mjs
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { parseProductView } from "../lib/data/view-events.ts";
import { INSERT_VIEW_SQL } from "../lib/db/view-queries.ts";

const { Client } = pg;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const TEST_SLUG = "iphone-16-128gb";

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

async function main() {
  console.log("\nValidation (lib/data/view-events.ts)");
  const google = parseProductView({
    slug: TEST_SLUG,
    referrer: "https://www.google.com/search?q=iphone+16+price+philippines",
  });
  check(
    "a well-formed view parses",
    google?.productSlug === TEST_SLUG,
    JSON.stringify(google),
  );
  check(
    "the referrer is reduced to its hostname",
    google?.referrerHost === "www.google.com",
    String(google?.referrerHost),
  );
  check(
    "no path or query survives into the event",
    JSON.stringify(google ?? {}).includes("search") === false,
  );
  check(
    "a direct visit carries no referrer",
    parseProductView({ slug: TEST_SLUG })?.referrerHost === null,
  );
  check(
    "a referrer that is not a URL is dropped, not stored",
    parseProductView({ slug: TEST_SLUG, referrer: "not a url at all" })
      ?.referrerHost === null,
  );
  check(
    "a non-http referrer is dropped",
    parseProductView({ slug: TEST_SLUG, referrer: "javascript:alert(1)" })
      ?.referrerHost === null,
  );
  check(
    "an over-long referrer is dropped but the view still parses",
    parseProductView({ slug: TEST_SLUG, referrer: `https://x.test/${"a".repeat(600)}` })
      ?.referrerHost === null,
  );
  check("a payload that is not an object is rejected", parseProductView(null) === null);
  check(
    "a payload without a slug is rejected",
    parseProductView({ referrer: "https://x.test" }) === null,
  );
  check(
    "a slug with a path separator is rejected",
    parseProductView({ slug: "iphone/../../etc" }) === null,
  );
  check(
    "an over-long slug is rejected",
    parseProductView({ slug: "a".repeat(81) }) === null,
  );

  const client = new Client({ connectionString: resolveConnectionString() });
  await client.connect();

  const removeRows = () =>
    client.query("DELETE FROM page_views WHERE product_slug = $1", [TEST_SLUG]);

  try {
    console.log("\nSchema");
    let tableOk = true;
    let tableDetail = "";
    try {
      await client.query("SELECT id FROM page_views LIMIT 0");
    } catch (error) {
      tableOk = false;
      tableDetail = error.message;
    }
    check("page_views table exists (migration 0004)", tableOk, tableDetail);

    await removeRows();

    if (tableOk) {
      console.log("\nWrite + read back (INSERT_VIEW_SQL)");
      const parsed = parseProductView({
        slug: TEST_SLUG,
        referrer: "https://www.bing.com/shop/iphone-16",
      });
      await client.query(INSERT_VIEW_SQL, [parsed.productSlug, parsed.referrerHost]);
      await client.query(INSERT_VIEW_SQL, [TEST_SLUG, null]);

      const { rows } = await client.query(
        "SELECT product_slug, referrer_host FROM page_views WHERE product_slug = $1 ORDER BY id",
        [TEST_SLUG],
      );
      check(
        "the parsed event stores exactly its slug and host",
        rows.length === 2 && rows[0].product_slug === TEST_SLUG,
        JSON.stringify(rows[0] ?? null),
      );
      check(
        "the referrer arrives as a bare hostname",
        rows[0]?.referrer_host === "www.bing.com",
        String(rows[0]?.referrer_host),
      );
      check(
        "a direct visit stores NULL rather than an empty string",
        rows[1]?.referrer_host === null,
        String(rows[1]?.referrer_host),
      );

      console.log("\nCleanup");
      const deleted = await removeRows();
      const { rows: remaining } = await client.query(
        "SELECT count(*)::int AS n FROM page_views WHERE product_slug = $1",
        [TEST_SLUG],
      );
      check(
        "test rows removed",
        remaining[0].n === 0,
        `${deleted.rowCount} deleted, ${remaining[0].n} left`,
      );
    }
  } finally {
    await client.end();
  }

  console.log(`\n${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nProduct-view verification failed: ${error.message}`);
  process.exit(1);
});
