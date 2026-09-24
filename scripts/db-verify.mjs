#!/usr/bin/env node
/**
 * Phase 3 verification: proves the schema actually behaves as designed
 * against a real database — tables, column types, CHECK constraints, and the
 * centavos round-trip through lib/db/money.ts.
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
        ('price_observations', 'price_alerts', 'click_events', 'schema_migrations')
      ORDER BY table_name
    `);
    const found = tables.map((row) => row.table_name);
    check(
      "all four tables exist",
      ["click_events", "price_alerts", "price_observations", "schema_migrations"].every((name) =>
        found.includes(name),
      ),
      found.join(", "),
    );

    const { rows: cols } = await client.query(`
      SELECT column_name, data_type, udt_name FROM information_schema.columns
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

    const { rows: applied } = await client.query("SELECT version FROM schema_migrations");
    check("0001_init.sql recorded as applied", applied.some((r) => r.version === "0001_init.sql"), applied.map((r) => r.version).join(", "));

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
      `INSERT INTO price_observations (product_slug, store_id, price_cents, availability, source, observed_at)
       VALUES ($1, 'shopee', $2, 'in_stock', 'live', now())`,
      [testSlug, cents],
    );
    const { rows: readBack } = await client.query(
      "SELECT price_cents FROM price_observations WHERE product_slug = $1",
      [testSlug],
    );
    check(
      "stored cents match toCents()",
      readBack.length === 1 && readBack[0].price_cents === cents,
      `${readBack[0]?.price_cents} === ${cents} (${fromCents(readBack[0]?.price_cents ?? 0)} pesos)`,
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

    console.log("\nConstraints");
    await expectFailure(
      client,
      "source must be demo|live",
      `INSERT INTO price_observations (product_slug, store_id, price_cents, source, observed_at)
       VALUES ('x', 'y', 100, 'banana', now())`,
    );
    await expectFailure(
      client,
      "price_cents must be positive",
      `INSERT INTO price_observations (product_slug, store_id, price_cents, source, observed_at)
       VALUES ('x', 'y', 0, 'live', now())`,
    );
    await expectFailure(
      client,
      "availability must be in_stock|out_of_stock",
      `INSERT INTO price_observations (product_slug, store_id, price_cents, availability, source, observed_at)
       VALUES ('x', 'y', 100, 'maybe', 'live', now())`,
    );
    await expectFailure(
      client,
      "alert email must contain @",
      `INSERT INTO price_alerts (product_slug, target_price_cents, email)
       VALUES ('x', 100, 'not-an-email')`,
    );

    console.log("\nCleanup");
    const deleted = await client.query("DELETE FROM price_observations WHERE product_slug = $1", [testSlug]);
    const { rows: remaining } = await client.query(
      "SELECT count(*)::int AS n FROM price_observations WHERE product_slug = $1",
      [testSlug],
    );
    check("test rows removed", remaining[0].n === 0, `${deleted.rowCount} deleted`);
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
