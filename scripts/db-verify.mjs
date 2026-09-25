#!/usr/bin/env node
/**
 * Phase 3 + Phase 24 + backend-completion verification: proves the schema
 * actually behaves as designed against a real database — tables, column
 * types, CHECK constraints, the catalog's keys and referential integrity
 * (migration 0006), marketplace listing identity (0007), observation
 * idempotency and alert access tokens (0008), and the centavos round-trip
 * through lib/db/money.ts.
 *
 * Inserts test rows and deletes them again, so the database is left clean.
 *
 * Usage: node scripts/db-verify.mjs
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { fromCents, toCents } from "../lib/db/money.ts";

const { Client } = pg;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

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

const results = [];
function check(label, condition, detail = "") {
  results.push({ label, ok: Boolean(condition), detail });
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function expectFailure(client, label, sql, params = []) {
  try {
    await client.query(sql, params);
    check(label, false, "query succeeded but should have been rejected");
  } catch (error) {
    check(label, true, error.constraint ? `constraint: ${error.constraint}` : "rejected");
  }
}

async function main() {
  const client = new Client({ connectionString: resolveConnectionString() });
  await client.connect();

  try {
    console.log("\nSchema");
    const { rows: tables } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN
        ('price_observations', 'price_alerts', 'click_events', 'page_views',
         'stores', 'products', 'product_variants', 'offers', 'marketplace_listings',
         'schema_migrations')
      ORDER BY table_name
    `);
    const found = tables.map((row) => row.table_name);
    check(
      "all ten tables exist",
      [
        "click_events",
        "page_views",
        "price_alerts",
        "price_observations",
        "products",
        "product_variants",
        "schema_migrations",
        "stores",
        "offers",
        "marketplace_listings",
      ].every((name) => found.includes(name)),
      found.join(", "),
    );

    const { rows: cols } = await client.query(`
      SELECT column_name, data_type, udt_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'price_observations' ORDER BY ordinal_position
    `);
    const columnMap = Object.fromEntries(cols.map((c) => [c.column_name, c]));
    check(
      "price_cents is integer (no floats for money)",
      columnMap.price_cents?.data_type === "integer",
      `${columnMap.price_cents?.data_type} (${columnMap.price_cents?.udt_name})`,
    );
    check(
      "observed_at is timestamptz",
      columnMap.observed_at?.udt_name === "timestamptz",
      columnMap.observed_at?.udt_name,
    );
    check("source column present", Boolean(columnMap.source), columnMap.source?.udt_name);
    check(
      "provider_id is required on every observation (migration 0003)",
      columnMap.provider_id?.is_nullable === "NO",
      `nullable=${columnMap.provider_id?.is_nullable ?? "absent"}`,
    );

    const { rows: clickCols } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'click_events' ORDER BY ordinal_position
    `);
    const clickColNames = clickCols.map((row) => row.column_name);
    check(
      "click_events has placement + campaign",
      ["placement", "campaign"].every((name) => clickColNames.includes(name)),
      clickColNames.join(", "),
    );

    const { rows: applied } = await client.query("SELECT version FROM schema_migrations");
    const appliedNames = applied.map((r) => r.version);
    check(
      "every migration is recorded as applied",
      [
        "0001_init.sql",
        "0002_click_campaign.sql",
        "0003_observation_provider.sql",
        "0004_page_views.sql",
        "0005_alert_one_active.sql",
        "0006_catalog.sql",
        "0007_marketplace_listings.sql",
        "0008_alert_token_obs_idempotency.sql",
      ].every((name) => appliedNames.includes(name)),
      appliedNames.join(", "),
    );

    console.log("\nMoney round-trip (lib/db/money.ts)");
    const pesoPrices = [56990, 1299, 0.99, 99.95];
    let roundTripOk = true;
    for (const pesos of pesoPrices) {
      const inserted = toCents(pesos);
      const returned = fromCents(inserted);
      if (Math.abs(returned - pesos) > 1e-9) {
        roundTripOk = false;
        console.log(`  FAIL  ${pesos} -> ${inserted}c -> ${returned}`);
      }
    }
    check("toCents/fromCents round-trip exact", roundTripOk, pesoPrices.join(", "));

    console.log("\nInsert + read back through Postgres");
    const testSlug = "verify-temp-product";
    const cents = toCents(56990);
    await client.query(
      `INSERT INTO price_observations (product_slug, store_id, price_cents, availability, source, observed_at, provider_id)
       VALUES ($1, 'shopee', $2, 'in_stock', 'live', now(), 'verify-script')`,
      [testSlug, cents],
    );
    const { rows: readBack } = await client.query(
      "SELECT price_cents, provider_id FROM price_observations WHERE product_slug = $1",
      [testSlug],
    );
    check(
      "stored cents match toCents()",
      readBack.length === 1 && readBack[0].price_cents === cents,
      `${readBack[0]?.price_cents} === ${cents} (${fromCents(readBack[0]?.price_cents ?? 0)} pesos)`,
    );
    check(
      "provenance round-trips with the price",
      readBack.length === 1 && readBack[0].provider_id === "verify-script",
      readBack[0]?.provider_id,
    );

    const { rows: idx } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'price_observations' AND schemaname = 'public'
    `);
    const indexNames = idx.map((r) => r.indexname);
    check(
      "history index present",
      indexNames.includes("price_observations_offer_idx"),
      indexNames.join(", "),
    );
    check(
      "provenance index present (migration 0003)",
      indexNames.includes("price_observations_provider_idx"),
      indexNames.join(", "),
    );

    console.log("\nConstraints");
    await expectFailure(
      client,
      "provider_id is required",
      `INSERT INTO price_observations (product_slug, store_id, price_cents, source, observed_at)
       VALUES ('x', 'y', 100, 'live', now())`,
    );
    await expectFailure(
      client,
      "source must be demo|live",
      `INSERT INTO price_observations (product_slug, store_id, price_cents, source, observed_at, provider_id)
       VALUES ('x', 'y', 100, 'banana', now(), 'verify-script')`,
    );
    await expectFailure(
      client,
      "price_cents must be positive",
      `INSERT INTO price_observations (product_slug, store_id, price_cents, source, observed_at, provider_id)
       VALUES ('x', 'y', 0, 'live', now(), 'verify-script')`,
    );
    await expectFailure(
      client,
      "availability must be in_stock|out_of_stock",
      `INSERT INTO price_observations (product_slug, store_id, price_cents, availability, source, observed_at, provider_id)
       VALUES ('x', 'y', 100, 'maybe', 'live', now(), 'verify-script')`,
    );
    await expectFailure(
      client,
      "alert email must contain @",
      `INSERT INTO price_alerts (product_slug, target_price_cents, email)
       VALUES ('x', 100, 'not-an-email')`,
    );

    console.log("\nCatalog schema (Phase 24)");
    const { rows: storeRows } = await client.query("SELECT id FROM stores ORDER BY id");
    const seededStores = ["abensons", "lazada", "shopee", "sm", "tiktok"];
    check(
      "stores seeded with the five retailers",
      seededStores.every((id) => storeRows.some((r) => r.id === id)),
      storeRows.map((r) => r.id).join(", "),
    );

    const testCatalogSlug = "verify-temp-catalog";
    await client.query(
      `INSERT INTO products (slug, name, brand, category_slug, sku, image, source)
       VALUES ($1, 'Verify Temp', 'Verify', 'phones', 'VRF-1', '/images/products/iphone-16-pro.jpg', 'demo')`,
      [testCatalogSlug],
    );
    await expectFailure(
      client,
      "product slug must be unique",
      `INSERT INTO products (slug, name, brand, category_slug, image)
       VALUES ($1, 'Dup', 'Verify', 'phones', '/x.jpg')`,
      [testCatalogSlug],
    );
    await expectFailure(
      client,
      "offer must reference a real product",
      `INSERT INTO offers (product_slug, store_id, price_cents, url)
       VALUES ('no-such-product', 'shopee', 1000, 'https://shopee.ph/x')`,
    );
    await expectFailure(
      client,
      "offer must reference a real store",
      `INSERT INTO offers (product_slug, store_id, price_cents, url)
       VALUES ($1, 'no-such-store', 1000, 'https://shopee.ph/x')`,
      [testCatalogSlug],
    );
    await expectFailure(
      client,
      "offer price must be positive",
      `INSERT INTO offers (product_slug, store_id, price_cents, url)
       VALUES ($1, 'shopee', 0, 'https://shopee.ph/x')`,
      [testCatalogSlug],
    );
    await expectFailure(
      client,
      "currency must be PHP",
      `INSERT INTO offers (product_slug, store_id, price_cents, currency, url)
       VALUES ($1, 'shopee', 1000, 'USD', 'https://shopee.ph/x')`,
      [testCatalogSlug],
    );
    await expectFailure(
      client,
      "variant must reference a real product",
      `INSERT INTO product_variants (product_slug, name)
       VALUES ('no-such-product', '256GB')`,
    );

    await client.query(
      `INSERT INTO offers (product_slug, store_id, price_cents, url, last_checked_at)
       VALUES ($1, 'shopee', 4599000, 'https://shopee.ph/verify', now())`,
      [testCatalogSlug],
    );
    const { rows: offerRead } = await client.query(
      "SELECT price_cents, currency, source, affiliate_url FROM offers WHERE product_slug = $1",
      [testCatalogSlug],
    );
    check(
      "catalog offer reads back as demo provenance with no fabricated affiliate link",
      offerRead.length === 1 &&
        offerRead[0].price_cents === 4599000 &&
        offerRead[0].currency === "PHP" &&
        offerRead[0].source === "demo" &&
        offerRead[0].affiliate_url === null,
      JSON.stringify(offerRead[0] ?? null),
    );
    await client.query(
      `INSERT INTO product_variants (product_slug, name, attributes)
       VALUES ($1, '256GB', '{"storage":"256GB"}'::jsonb)`,
      [testCatalogSlug],
    );
    await expectFailure(
      client,
      "one variant name per product",
      `INSERT INTO product_variants (product_slug, name) VALUES ($1, '256GB')`,
      [testCatalogSlug],
    );
    await expectFailure(
      client,
      "one offer per product and store",
      `INSERT INTO offers (product_slug, store_id, price_cents, url)
       VALUES ($1, 'shopee', 1, 'https://shopee.ph/y')`,
      [testCatalogSlug],
    );

    console.log("\nMarketplace listings (backend §8)");
    const { rows: listingCols } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'marketplace_listings' ORDER BY ordinal_position
    `);
    const listingColNames = listingCols.map((row) => row.column_name);
    check(
      "listing carries identity, provenance and status columns",
      [
        "store_id",
        "external_id",
        "product_slug",
        "title",
        "product_url",
        "affiliate_url",
        "seller_name",
        "source",
        "status",
        "last_seen_at",
      ].every((name) => listingColNames.includes(name)),
      listingColNames.join(", "),
    );

    const { rows: listingInsert } = await client.query(
      `INSERT INTO marketplace_listings
         (store_id, external_id, product_slug, title, product_url, source, status, last_seen_at)
       VALUES ('shopee', 'verify-listing-1', $1, 'Verify Temp', 'https://shopee.ph/verify', 'demo', 'active', now())
       RETURNING id`,
      [testCatalogSlug],
    );
    const listingId = listingInsert[0]?.id;
    check("listing row inserts", Boolean(listingId), `id=${listingId}`);
    await expectFailure(
      client,
      "external_id is unique per store",
      `INSERT INTO marketplace_listings (store_id, external_id, product_slug, title, product_url)
       VALUES ('shopee', 'verify-listing-1', $1, 'Dup', 'https://shopee.ph/dup')`,
      [testCatalogSlug],
    );
    await expectFailure(
      client,
      "listing status must be active|inactive|unavailable",
      `INSERT INTO marketplace_listings (store_id, external_id, product_slug, title, product_url, status)
       VALUES ('shopee', 'verify-bad-status', $1, 'Bad', 'https://shopee.ph/bad', 'paused')`,
      [testCatalogSlug],
    );
    await expectFailure(
      client,
      "listing must reference a real store",
      `INSERT INTO marketplace_listings (store_id, external_id, title, product_url)
       VALUES ('no-such-store', 'verify-x', 'X', 'https://example.com')`,
    );

    await client.query("UPDATE offers SET listing_id = $1 WHERE product_slug = $2", [
      listingId,
      testCatalogSlug,
    ]);
    const { rows: linked } = await client.query(
      `SELECT o.listing_id, l.external_id, l.status
       FROM offers o JOIN marketplace_listings l ON l.id = o.listing_id
       WHERE o.product_slug = $1`,
      [testCatalogSlug],
    );
    check(
      "offer links to its marketplace listing",
      linked.length === 1 &&
        linked[0].listing_id === listingId &&
        linked[0].external_id === "verify-listing-1",
      JSON.stringify(linked[0] ?? null),
    );

    console.log("\nObservation idempotency (backend §27)");
    const idempotentAt = "2026-01-01T00:00:00+00:00";
    const { rows: idemIdx } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'price_observations' AND schemaname = 'public'
    `);
    check(
      "idempotency index present (0008)",
      idemIdx.map((r) => r.indexname).includes("price_observations_idempotency_idx"),
      idemIdx.map((r) => r.indexname).join(", "),
    );
    await client.query(
      `INSERT INTO price_observations (product_slug, store_id, price_cents, source, observed_at, provider_id)
       VALUES ($1, 'shopee', 100000, 'live', $2, 'verify-script')`,
      [testSlug, idempotentAt],
    );
    await expectFailure(
      client,
      "the same observation is not written twice",
      `INSERT INTO price_observations (product_slug, store_id, price_cents, source, observed_at, provider_id)
       VALUES ($1, 'shopee', 100000, 'live', $2, 'verify-script')`,
      [testSlug, idempotentAt],
    );
    await client.query(
      `INSERT INTO price_observations (product_slug, store_id, price_cents, source, observed_at, provider_id)
       VALUES ($1, 'shopee', 99900, 'demo', $2, 'verify-script')`,
      [testSlug, idempotentAt],
    );
    const { rows: bothSources } = await client.query(
      `SELECT source, count(*)::int AS n FROM price_observations
       WHERE product_slug = $1 AND observed_at = $2 GROUP BY source`,
      [testSlug, idempotentAt],
    );
    check(
      "demo and live readings at the same instant stay separate rows",
      bothSources.length === 2,
      JSON.stringify(bothSources),
    );

    console.log("\nAlert access tokens (backend §25)");
    const { rows: alertCols } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'price_alerts' ORDER BY ordinal_position
    `);
    const alertColNames = alertCols.map((row) => row.column_name);
    check("access_token column present on price_alerts", alertColNames.includes("access_token"), alertColNames.join(", "));
    const { rows: nullTokens } = await client.query(
      "SELECT count(*)::int AS n FROM price_alerts WHERE access_token IS NULL",
    );
    check("every stored alert has a token (0008 backfill)", nullTokens[0].n === 0, `${nullTokens[0].n} null`);
    const { rows: nullableCol } = await client.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'price_alerts' AND column_name = 'access_token'
    `);
    check(
      "access_token is NOT NULL — the invariant is type-enforced (0010)",
      nullableCol[0]?.is_nullable === "NO",
      String(nullableCol[0]?.is_nullable ?? "missing"),
    );
    let tokenlessRejected = false;
    try {
      await client.query(
        `INSERT INTO price_alerts (product_slug, target_price_cents, email)
         VALUES ('x', 100, 'verify-tokenless@example.com')`,
      );
    } catch {
      tokenlessRejected = true;
    }
    check("an alert written without a token is rejected by the database", tokenlessRejected);
    const { rows: alertIdx } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'price_alerts' AND schemaname = 'public'
    `);
    const alertIdxNames = alertIdx.map((r) => r.indexname);
    check(
      "token lookup index present (email + token)",
      alertIdxNames.includes("price_alerts_token_idx"),
      alertIdxNames.join(", "),
    );
    await client.query(
      `INSERT INTO price_alerts (product_slug, target_price_cents, email, access_token)
       VALUES ('x', 100, 'verify-token@example.com', 'verify-known-token')`,
    );
    const { rows: tokenRead } = await client.query(
      "SELECT access_token FROM price_alerts WHERE email = 'verify-token@example.com'",
    );
    check(
      "an alert stores the access token it was created with",
      tokenRead.length === 1 && tokenRead[0].access_token === "verify-known-token",
      JSON.stringify(tokenRead[0] ?? null),
    );

    console.log("\nCleanup");
    const deleted = await client.query("DELETE FROM price_observations WHERE product_slug = $1", [testSlug]);
    const { rows: remaining } = await client.query(
      "SELECT count(*)::int AS n FROM price_observations WHERE product_slug = $1",
      [testSlug],
    );
    check("test rows removed", remaining[0].n === 0, `${deleted.rowCount} deleted`);

    await client.query("DELETE FROM marketplace_listings WHERE external_id LIKE 'verify-listing%'");
    await client.query("DELETE FROM price_alerts WHERE email = 'verify-token@example.com'");

    const deletedCatalog = await client.query("DELETE FROM products WHERE slug = $1", [testCatalogSlug]);
    const { rows: catalogRemaining } = await client.query(
      `SELECT
         (SELECT count(*)::int FROM products WHERE slug = $1)          AS p,
         (SELECT count(*)::int FROM offers WHERE product_slug = $1)    AS o,
         (SELECT count(*)::int FROM product_variants WHERE product_slug = $1) AS v`,
      [testCatalogSlug],
    );
    check(
      "catalog test rows removed (variant + offer cascade)",
      catalogRemaining[0].p === 0 && catalogRemaining[0].o === 0 && catalogRemaining[0].v === 0,
      `${deletedCatalog.rowCount} product deleted`,
    );
  } finally {
    await client.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    failed.forEach((f) => console.error(`  FAILED: ${f.label}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\nVerification failed: ${error.message}`);
  process.exit(1);
});
