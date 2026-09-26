#!/usr/bin/env node
/**
 * Live Data Readiness pass — page freshness (§2), live/demo history
 * separation (§5), and the wiring behind them (§9).
 *
 * Three halves:
 *  - the build manifest: every DB-dependent route carries a bounded ISR
 *    window (product pages 60s, catalog surfaces 5 minutes) instead of the
 *    old cache-forever, and /product/[slug] accepts slugs it never saw at
 *    build time;
 *  - source wiring: the product page declares its revalidate window, no
 *    longer hard-codes `dynamicParams = false`, and 404s unknown slugs from
 *    generateMetadata; the ingest route revalidates affected paths after
 *    writing;
 *  - over HTTP against a db-provider server: an unknown slug is a real 404,
 *    a product INSERTED after the build resolves without a rebuild, a live
 *    product never reads the demo rows stored under it, and an updated price
 *    becomes visible inside the ISR window — waited out for real, not mocked.
 *
 * Inserts a throwaway product and deletes it again; the catalog is left as
 * it was.
 *
 * Usage: node scripts/freshness-verify.mjs   (requires a current `npm run build`)
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { toCents } from "../lib/db/money.ts";
import { INSERT_OBSERVATIONS_SQL } from "../lib/db/observation-queries.ts";

const { Client } = pg;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const APP_PORT = 4001;
const PROBE_SLUG = "__verify-freshness-probe__";
const SOURCE_SLUG = "iphone-16-128gb";
const NEW_PRICE = 12345.67;
/** ISR windows the app declares — asserted, not assumed. */
const PRODUCT_REVALIDATE = 60;
const SURFACE_REVALIDATE = 300;

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startServer(port, extraEnv) {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
  });
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

function source(file) {
  return readFileSync(path.join(root, file), "utf8");
}

/* --------------------------------- main ---------------------------------- */

async function main() {
  console.log("\nBuild manifest (ISR windows)");
  const manifestPath = path.join(root, ".next", "prerender-manifest.json");
  if (!existsSync(manifestPath)) {
    console.log("  FAIL  no prerender manifest — run npm run build first");
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const productRoute = manifest.routes?.[`/product/${SOURCE_SLUG}`];
  check(
    "product pages are still prerendered at build (SEO/fast first hit preserved)",
    Boolean(productRoute),
    `no /product/${SOURCE_SLUG} entry`,
  );
  check(
    `product pages carry a bounded ISR window (${PRODUCT_REVALIDATE}s), not cache-forever`,
    productRoute?.initialRevalidateSeconds === PRODUCT_REVALIDATE,
    `got ${JSON.stringify(productRoute?.initialRevalidateSeconds)}`,
  );
  check(
    "the product route accepts slugs that were not in the build",
    manifest.dynamicRoutes?.["/product/[slug]"]?.fallback === null,
    JSON.stringify(manifest.dynamicRoutes?.["/product/[slug]"]?.fallback),
  );
  for (const route of ["/", "/categories", "/price-drops", "/sitemap.xml"]) {
    const entry = manifest.routes?.[route];
    check(
      `${route} carries a bounded ISR window (${SURFACE_REVALIDATE}s)`,
      entry?.initialRevalidateSeconds === SURFACE_REVALIDATE,
      `got ${JSON.stringify(entry?.initialRevalidateSeconds)}`,
    );
  }

  console.log("\nSource wiring");
  const productPage = source(path.join("app", "product", "[slug]", "page.tsx"));
  check(
    "the product page declares its revalidate window",
    productPage.includes(`export const revalidate = ${PRODUCT_REVALIDATE};`),
  );
  check(
    "the product page no longer exports dynamicParams at all",
    !productPage.includes("export const dynamicParams"),
  );
  check(
    "unknown slugs 404 from generateMetadata (checked before anything streams)",
    /generateMetadata[\s\S]*?notFound\(\)/.test(productPage),
  );
  check(
    "the product segment keeps NO loading.tsx (its fallback would stream a 200 first)",
    !existsSync(path.join(root, "app", "product", "[slug]", "loading.tsx")),
  );
  const ingestRoute = source(path.join("app", "api", "ingest", "route.ts"));
  check(
    "the ingest route revalidates affected paths after writing",
    ingestRoute.includes("revalidatePath("),
  );
  for (const file of [
    path.join("app", "page.tsx"),
    path.join("app", "categories", "page.tsx"),
    path.join("app", "categories", "[slug]", "page.tsx"),
    path.join("app", "price-drops", "page.tsx"),
    path.join("app", "sitemap.ts"),
  ]) {
    check(`${file} declares an ISR window`, source(file).includes("revalidate = 300"));
  }
  const observations = source(path.join("lib", "db", "observations.ts"));
  check(
    "resolvePriceSeries blocks the catalog fallback for live products",
    observations.includes("if (live) return"),
  );

  const client = new Client({ connectionString: resolveConnectionString() });
  await client.connect();
  let server = null;

  try {
    // Start clean in case a previous run was interrupted.
    await client.query("DELETE FROM price_observations WHERE product_slug = $1", [PROBE_SLUG]);
    await client.query("DELETE FROM products WHERE slug = $1", [PROBE_SLUG]);

    console.log(`\nHTTP against the database (port ${APP_PORT}, DATA_PROVIDER=db)`);
    server = startServer(APP_PORT, {
      NEXT_PUBLIC_DEMO_MODE: "false",
      DATA_PROVIDER: "db",
    });
    const up = await waitForServer(server, APP_PORT);
    check("server starts against the database", up, "next start never became ready");
    if (!up) {
      throw new Error(`next start never became ready: ${server.readOutput().slice(-800)}`);
    }

    const unknown = await get(APP_PORT, "/product/__verify-no-such-product__");
    check(
      "an unknown slug answers 404, not a soft-404",
      unknown.status === 404,
      `status ${unknown.status}`,
    );

    // A product introduced by ingestion after the build: live offers, no
    // relationship to the build-time slug list, and demo rows underneath it
    // that its live status must keep it from reading.
    await client.query(
      `INSERT INTO products (slug, name, brand, category_slug, sku, image, source, active)
       SELECT $1, name || ' — freshness probe', brand, category_slug, sku, image, 'live', true
         FROM products WHERE slug = $2`,
      [PROBE_SLUG, SOURCE_SLUG],
    );
    await client.query(
      `INSERT INTO offers
         (product_slug, store_id, price_cents, original_price_cents, currency, availability,
          seller, url, affiliate_url, condition, source, external_id, last_checked_at, updated_at)
       SELECT $1, store_id, price_cents, original_price_cents, currency, availability,
          seller, url, affiliate_url, condition, 'live', external_id, now(), now()
         FROM offers WHERE product_slug = $2`,
      [PROBE_SLUG, SOURCE_SLUG],
    );

    const seriesRows = { slug: [], store: [], listing: [], price: [], availability: [], source: [], at: [], provider: [] };
    for (let offset = 19; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setUTCHours(12, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - offset);
      seriesRows.slug.push(PROBE_SLUG);
      seriesRows.store.push("demo");
      seriesRows.listing.push("");
      seriesRows.price.push(toCents(99999));
      seriesRows.availability.push("in_stock");
      seriesRows.source.push("demo");
      seriesRows.at.push(date.toISOString());
      seriesRows.provider.push("freshness-verify");
    }
    await client.query(INSERT_OBSERVATIONS_SQL, [
      seriesRows.slug,
      seriesRows.store,
      seriesRows.listing,
      seriesRows.price,
      seriesRows.availability,
      seriesRows.source,
      seriesRows.at,
      seriesRows.provider,
    ]);

    const probe = await get(APP_PORT, `/product/${PROBE_SLUG}`);
    check(
      "a product inserted after the build resolves without a redeploy",
      probe.status === 200 && probe.text.includes("freshness probe"),
      `status ${probe.status}`,
    );
    check(
      "its live offers are not labelled sample",
      !probe.text.includes("Sample data · last updated"),
      "sample label found on a live product",
    );
    check(
      "its demo history is not plotted (live product, demo rows only)",
      !probe.text.includes("Sample history for demonstration"),
      "chart claimed demo history for a live product",
    );
    check(
      "its verdict does not borrow the demo history either",
      !probe.text.includes("Sample verdict") &&
        probe.text.includes("Not enough history yet"),
      probe.text.includes("Sample verdict")
        ? "verdict rendered from demo history"
        : "expected the insufficient-history verdict",
    );

    console.log("\nPrice update becomes visible inside the ISR window");
    await client.query(
      "UPDATE offers SET price_cents = $1, updated_at = now(), last_checked_at = now() WHERE product_slug = $2",
      [toCents(NEW_PRICE), PROBE_SLUG],
    );
    const expected = NEW_PRICE.toLocaleString("en-PH");
    let visible = false;
    // The window is 60s: the first request after it expires serves the stale
    // page and regenerates in the background, the next one is fresh. Bound
    // the wait generously; a page that NEVER refreshes fails here.
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline && !visible) {
      const page = await get(APP_PORT, `/product/${PROBE_SLUG}`);
      if (page.status === 200 && page.text.includes(expected)) visible = true;
      if (!visible) await sleep(10_000);
    }
    check(
      "the updated price reaches the public page without a rebuild",
      visible,
      `₱${expected} never appeared within the ISR window`,
    );
  } finally {
    if (server) await killServer(server);
    await client.query("DELETE FROM price_observations WHERE product_slug = $1", [PROBE_SLUG]).catch(() => {});
    await client.query("DELETE FROM products WHERE slug = $1", [PROBE_SLUG]).catch(() => {});
    await client.end();
  }

  console.log(`\n${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nFreshness verification failed: ${error.message}`);
  process.exit(1);
});
