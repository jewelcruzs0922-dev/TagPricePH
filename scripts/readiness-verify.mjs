#!/usr/bin/env node
/**
 * Production-readiness verification (business-readiness brief, Phases 6/8/9/10).
 *
 * What this proves, by running it rather than by re-reading code:
 *   - the canonical site URL is configurable (NEXT_PUBLIC_SITE_URL) and every
 *     SEO surface derives from the one resolver;
 *   - search results are noindexed, sitemap/robots/canonical agree on origin,
 *     and the og/twitter card ships an image;
 *   - site-level WebSite/Organization JSON-LD is present and parses;
 *   - /api/health answers 200 and the cron sweep accepts Vercel's GET with
 *     the same fail-closed bearer auth as POST;
 *   - a search actually lands in search_queries (the analytics funnel), then
 *     cleans its row up;
 *   - the error boundaries, empty-state guards, and admin funnel sections
 *     exist where they are needed.
 *
 * Usage: node scripts/readiness-verify.mjs   (requires `npm run build` first)
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { resolveBaseUrl } from "../lib/utils/seo.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = 4000;
const BASE = `http://localhost:${APP_PORT}`;
const TEST_CRON = "readiness-cron-secret-3a71";
const PROBE_QUERY = `readiness-probe-${Date.now()}`;

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? `  -  ${detail}` : ""}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

/* ---------------------------------- unit ---------------------------------- */

function urlResolutionChecks() {
  console.log("Site URL resolution (lib/utils/seo.ts)");
  const fallback = "https://tagpriceph.vercel.app";
  check(
    "no configuration falls back to the deployment URL",
    resolveBaseUrl({}) === fallback,
    resolveBaseUrl({}),
  );
  check(
    "NEXT_PUBLIC_SITE_URL wins when set",
    resolveBaseUrl({ siteUrl: "https://tagpriceph.com" }) === "https://tagpriceph.com",
  );
  check(
    "a trailing slash is normalised away",
    resolveBaseUrl({ siteUrl: "https://tagpriceph.com/" }) === "https://tagpriceph.com",
  );
  check(
    "a scheme-less domain gains https",
    resolveBaseUrl({ siteUrl: "tagpriceph.com" }) === "https://tagpriceph.com",
  );
  check(
    "an existing scheme is kept as-is",
    resolveBaseUrl({ siteUrl: "http://localhost:3000" }) === "http://localhost:3000",
  );
  check(
    "whitespace-only input is treated as unset",
    resolveBaseUrl({ siteUrl: "   " }) === fallback,
  );
  check(
    "the Vercel production URL is the second choice",
    resolveBaseUrl({ productionUrl: "myapp.vercel.app" }) === "https://myapp.vercel.app",
  );
  check(
    "the configured URL outranks the Vercel production URL",
    resolveBaseUrl({ siteUrl: "https://custom.ph", productionUrl: "myapp.vercel.app" }) ===
      "https://custom.ph",
  );
}

function sourceChecks() {
  console.log("Wiring (source)");
  const seoSource = read("lib/utils/seo.ts");
  check(
    "the resolver reads NEXT_PUBLIC_SITE_URL",
    seoSource.includes("NEXT_PUBLIC_SITE_URL"),
  );
  check(
    "preview deployments never become canonical (VERCEL_ENV gate)",
    seoSource.includes('VERCEL_ENV === "production"'),
  );

  const searchPage = read(path.join("app", "search", "page.tsx"));
  const robotsHits = searchPage.match(/index: false/g) ?? [];
  check(
    "every /search metadata variant is noindexed",
    robotsHits.length >= 3,
    `${robotsHits.length} robots overrides`,
  );
  check(
    "the search page records queries through recordSearchQuery",
    searchPage.includes("recordSearchQuery("),
  );

  check("app/error.tsx exists", existsSync(path.join(root, "app", "error.tsx")));
  check(
    "app/global-error.tsx exists",
    existsSync(path.join(root, "app", "global-error.tsx")),
  );
  check(
    "the error boundary never renders the exception text",
    !read(path.join("app", "error.tsx")).includes("error.message"),
  );

  const chart = read(path.join("components", "price-history", "PriceHistoryChart.tsx"));
  check(
    "the price chart guards the 0-point series (no ₱Infinity)",
    chart.includes("points.length === 0"),
  );

  const comparison = read(path.join("components", "comparison", "StoreComparison.tsx"));
  check(
    "the comparison card handles zero offers",
    comparison.includes("sorted.length === 0"),
  );

  const layout = read(path.join("app", "layout.tsx"));
  check(
    "the layout publishes WebSite/Organization JSON-LD",
    layout.includes('"@type": "WebSite"') || layout.includes('"@type":"WebSite"'),
  );
  check(
    "the layout ships an og/twitter image",
    layout.includes("hero-media-1.png"),
  );
  check(
    "site JSON-LD is serialized through serializeJsonLd",
    layout.includes("serializeJsonLd(siteJsonLd)"),
  );

  const stats = read(path.join("lib", "admin", "stats.ts"));
  check(
    "admin stats read top products and clicks by store",
    stats.includes("TOP_PRODUCTS_SQL") && stats.includes("CLICKS_BY_STORE_SQL"),
  );
  const adminPage = read(path.join("app", "admin", "page.tsx"));
  for (const key of ["searches", "top-products", "clicks-by-store"]) {
    check(
      `admin dashboard carries the "${key}" section`,
      adminPage.includes(`adminKey="${key}"`),
    );
  }

  const searchQueries = read(path.join("lib", "db", "search-queries.ts"));
  check(
    "search recording stores only query text and result count",
    searchQueries.includes("INSERT INTO search_queries (query, result_count)"),
  );
  check(
    "migration 0012 creates the search_queries table",
    existsSync(path.join(root, "db", "migrations", "0012_search_queries.sql")),
  );

  const checkRoute = read(path.join("app", "api", "alerts", "check", "route.ts"));
  check(
    "the cron sweep exposes GET (Vercel cron) with shared auth",
    /export async function GET\(/.test(checkRoute) &&
      checkRoute.includes("return handleCheck(request)"),
  );

  const healthRoute = read(path.join("app", "api", "health", "route.ts"));
  check(
    "the health probe reports status only",
    healthRoute.includes("{ ok: true }") && !healthRoute.includes("process.env."),
  );

  const views = read(path.join("app", "api", "views", "route.ts"));
  check(
    "view failures log through the structured logger",
    views.includes('logEvent("error", "views.record-failed"'),
  );
  const search = read(path.join("app", "api", "search", "route.ts"));
  check(
    "search failures log through the structured logger",
    search.includes('logEvent("error", "search.failed"'),
  );

  check(
    "vercel.json schedules the alert sweep",
    read("vercel.json").includes("/api/alerts/check"),
  );
}

/* ---------------------------------- live ---------------------------------- */

function startServer() {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  return spawn(process.execPath, [nextBin, "start", "-p", String(APP_PORT)], {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      CRON_SECRET: TEST_CRON,
      NEXT_PUBLIC_DEMO_MODE: "true",
    },
  });
}

async function waitForServer(child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(3000) });
      if (response.status === 200) return true;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  return false;
}

async function stopServer(child) {
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 5000);
  });
}

async function liveChecks(expectedBaseUrl) {
  const expectedHost = new URL(expectedBaseUrl).host;

  console.log("\nHealth probe (Phase 9/10)");
  const health = await fetch(`${BASE}/api/health`, {
    headers: { "cache-control": "no-store" },
    signal: AbortSignal.timeout(20_000),
  });
  const healthBody = await health.json().catch(() => null);
  check(
    "/api/health answers 200 when the database is reachable",
    health.status === 200 && healthBody?.ok === true,
    `status ${health.status} body ${JSON.stringify(healthBody)}`,
  );
  check(
    "/api/health carries no-cache headers",
    health.headers.get("cache-control") === "no-store",
  );

  console.log("\nCron sweep over GET (Vercel cron compatibility)");
  const cronNoAuth = await fetch(`${BASE}/api/alerts/check`, {
    signal: AbortSignal.timeout(20_000),
  });
  check(
    "GET without a bearer is refused with 401",
    cronNoAuth.status === 401,
    `${cronNoAuth.status}`,
  );
  const cronWrong = await fetch(`${BASE}/api/alerts/check`, {
    headers: { Authorization: "Bearer not-the-secret" },
    signal: AbortSignal.timeout(20_000),
  });
  check(
    "GET with a wrong bearer is refused with 401",
    cronWrong.status === 401,
    `${cronWrong.status}`,
  );
  const cronOk = await fetch(`${BASE}/api/alerts/check`, {
    headers: { Authorization: `Bearer ${TEST_CRON}` },
    signal: AbortSignal.timeout(20_000),
  });
  check(
    "GET with the right bearer runs the sweep",
    cronOk.status === 200,
    `${cronOk.status}`,
  );

  console.log("\nSEO surfaces (Phase 6)");
  const home = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(20_000) });
  const homeHtml = await home.text();
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(homeHtml)?.[1] ?? "";
  check(
    "the homepage canonical resolves through the site URL",
    canonical.startsWith(expectedBaseUrl),
    `canonical ${canonical}, expected host ${expectedHost}`,
  );
  const ogImage = /<meta property="og:image" content="([^"]+)"/.exec(homeHtml)?.[1] ?? "";
  check(
    "og:image is published with an absolute URL",
    ogImage.startsWith(expectedBaseUrl) && ogImage.endsWith(".png"),
    ogImage,
  );
  const twitterImage = /<meta name="twitter:image" content="([^"]+)"/.exec(homeHtml)?.[1] ?? "";
  check(
    "twitter:image is published with an absolute URL",
    twitterImage.startsWith(expectedBaseUrl),
    twitterImage,
  );
  const jsonLdBlocks = [...homeHtml.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )].map((match) => match[1]);
  check("the homepage emits JSON-LD blocks", jsonLdBlocks.length >= 1, `${jsonLdBlocks.length}`);
  let sawWebSite = false;
  let allParsed = jsonLdBlocks.length >= 1;
  let noRawMarkup = true;
  for (const block of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block);
      const types = parsed["@graph"]
        ? parsed["@graph"].map((node) => node["@type"])
        : [parsed["@type"]];
      if (types.includes("WebSite") && types.includes("Organization")) sawWebSite = true;
    } catch {
      allParsed = false;
    }
    if (block.includes("<")) noRawMarkup = false;
  }
  check("JSON-LD parses as JSON", allParsed);
  check("JSON-LD contains no raw '<'", noRawMarkup);
  check(
    "WebSite + Organization schema are present",
    sawWebSite,
  );

  const sitemap = await fetch(`${BASE}/sitemap.xml`, { signal: AbortSignal.timeout(20_000) });
  const sitemapText = await sitemap.text();
  check(
    "sitemap entries use the configured origin",
    sitemapText.includes(`<loc>${expectedBaseUrl}/`),
    `expected ${expectedBaseUrl}`,
  );

  const robots = await fetch(`${BASE}/robots.txt`, { signal: AbortSignal.timeout(20_000) });
  const robotsText = await robots.text();
  check(
    "robots.txt points the sitemap at the configured origin",
    robotsText.includes(`Sitemap: ${expectedBaseUrl}/sitemap.xml`),
    robotsText.split("\n").find((line) => line.startsWith("Sitemap:")) ?? "",
  );

  const searchPage = await fetch(`${BASE}/search?q=${encodeURIComponent(PROBE_QUERY)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const searchHtml = await searchPage.text();
  check(
    "search results respond 200",
    searchPage.status === 200,
    `${searchPage.status}`,
  );
  check(
    "search results are noindexed",
    /<meta name="robots" content="noindex[^"]*"/.test(searchHtml),
    "no robots meta found",
  );
  const searchCanonical = /<link rel="canonical" href="([^"]+)"/.exec(searchHtml)?.[1] ?? "";
  check(
    "search canonical carries the query on the configured origin",
    searchCanonical.startsWith(expectedBaseUrl) && searchCanonical.includes("q="),
    searchCanonical,
  );
  const bareSearch = await fetch(`${BASE}/search`, { signal: AbortSignal.timeout(20_000) });
  const bareHtml = await bareSearch.text();
  check(
    "the bare /search page is noindexed too",
    /<meta name="robots" content="noindex[^"]*"/.test(bareHtml),
  );

  const product = await fetch(`${BASE}/product/iphone-16-128gb`, {
    signal: AbortSignal.timeout(20_000),
  });
  const productHtml = await product.text();
  const productCanonical = /<link rel="canonical" href="([^"]+)"/.exec(productHtml)?.[1] ?? "";
  check(
    "product canonicals use the configured origin",
    productCanonical.startsWith(expectedBaseUrl),
    productCanonical,
  );

  console.log("\nSearch analytics recorded (Phase 8)");
  let recorded = null;
  for (let attempt = 0; attempt < 25 && !recorded; attempt += 1) {
    await sleep(400);
    recorded = await findRecordedQuery().catch(() => null);
  }
  check(
    "the search landed in search_queries",
    Boolean(recorded),
    `no row for "${PROBE_QUERY}" within 10s`,
  );
  if (recorded) {
    check(
      "the row carries a non-negative result count",
      Number.isInteger(recorded.result_count) && recorded.result_count >= 0,
      `result_count ${recorded.result_count}`,
    );
  }
}

/* --------------------------------- cleanup -------------------------------- */

function resolveConnectionString() {
  const candidates = [
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_URL,
    process.env.DATABASE_URL,
  ].filter(Boolean);
  const url = candidates.find((value) => !value.includes("-pooler")) ?? candidates[0];
  return url ?? null;
}

async function findRecordedQuery() {
  const connectionString = resolveConnectionString();
  if (!connectionString) return null;
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query(
      "SELECT query, result_count FROM search_queries WHERE query = $1",
      [PROBE_QUERY],
    );
    return result.rows[0] ?? null;
  } finally {
    await client.end().catch(() => {});
  }
}

async function cleanupProbeRows() {
  const connectionString = resolveConnectionString();
  if (!connectionString) {
    console.error("cleanup skipped: no Postgres connection string");
    failed += 1;
    return;
  }
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query("DELETE FROM search_queries WHERE query = $1", [PROBE_QUERY]);
  } catch (error) {
    console.error(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  } finally {
    await client.end().catch(() => {});
  }
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
  if (!existsSync(path.join(root, ".next"))) {
    console.error("No .next directory - run npm run build first.");
    process.exit(1);
  }
  const envFile = path.join(root, ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  // Mirror of the build-time resolution in lib/utils/seo.ts. NEXT_PUBLIC_*
  // values are baked in at build; this script runs after the build in the
  // verify chain, so the same inputs produce the same origin.
  const expectedBaseUrl = resolveBaseUrl({
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    productionUrl:
      process.env.VERCEL_ENV === "production"
        ? process.env.VERCEL_PROJECT_PRODUCTION_URL
        : undefined,
  });

  urlResolutionChecks();
  sourceChecks();

  const server = startServer();
  try {
    const up = await waitForServer(server);
    check("server starts", up, "next start never became ready");
    if (up) await liveChecks(expectedBaseUrl);
  } finally {
    await stopServer(server);
  }

  await cleanupProbeRows();
}

await main();
console.log(`\n${passed}/${passed + failed} checks passed.\n`);
process.exit(failed === 0 ? 0 : 1);
