#!/usr/bin/env node
/**
 * Applies pending SQL migrations from db/migrations/ in filename order.
 *
 * Each file runs inside its own transaction and is recorded in
 * `schema_migrations`, so a failing migration rolls back cleanly and is
 * never counted as applied.
 *
 * Usage:
 *   node scripts/migrate.mjs           apply all pending migrations
 *   node scripts/migrate.mjs --status  show applied / pending, change nothing
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "db", "migrations");

// Next.js loads .env.local for the app; this script has to do it itself.
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function resolveConnectionString() {
  const candidates = [
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_URL,
    process.env.DATABASE_URL,
  ].filter(Boolean);

  if (candidates.length === 0) {
    console.error(
      "\nNo Postgres connection string found.\n" +
        "Expected POSTGRES_URL_NON_POOLING, POSTGRES_URL, DATABASE_URL_UNPOOLED or DATABASE_URL " +
        `in ${envFile} or the process environment.\n`,
    );
    process.exit(1);
  }

  // Neon names pooled hosts "-pooler". DDL must not run through pgbouncer's
  // transaction pooling, so prefer an unpooled URL when one is present.
  const url = candidates.find((value) => !value.includes("-pooler")) ?? candidates[0];

  if (url.includes("SENSITIVE")) {
    console.error(
      "\nThe connection string in .env.local is a [SENSITIVE] placeholder, not a real value.\n" +
        "Vercel will not download production/preview secret values to your machine.\n" +
        "In the Vercel dashboard: Storage → your Neon database → Quickstart → show secret → copy the .env.local snippet.\n",
    );
    process.exit(1);
  }
  return url;
}

/** Host and database only — never echo credentials. */
function describe(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}/${parsed.pathname.replace(/^\//, "") || "?"}`;
  } catch {
    return "(unparseable)";
  }
}

function loadMigrations() {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      version: file,
      sql: readFileSync(path.join(migrationsDir, file), "utf8"),
    }));
}

async function main() {
  const statusOnly = process.argv.includes("--status");
  const url = resolveConnectionString();
  const migrations = loadMigrations();

  if (migrations.length === 0) {
    console.log("No migration files found.");
    return;
  }

  // DDL goes through the unpooled connection when one is available.
  const client = new Client({ connectionString: url });

  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    const applied = new Set(rows.map((row) => row.version));
    const pending = migrations.filter((migration) => !applied.has(migration.version));

    console.log(`Database: ${describe(url)}`);
    console.log(`Migrations on disk: ${migrations.length} | applied: ${applied.size} | pending: ${pending.length}`);

    if (statusOnly) {
      for (const migration of migrations) {
        console.log(`  ${applied.has(migration.version) ? "[applied] " : "[pending] "} ${migration.version}`);
      }
      return;
    }

    if (pending.length === 0) {
      console.log("Nothing to do — schema is up to date.");
      return;
    }

    for (const migration of pending) {
      process.stdout.write(`Applying ${migration.version} ... `);
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [migration.version],
        );
        await client.query("COMMIT");
        console.log("ok");
      } catch (error) {
        await client.query("ROLLBACK");
        console.log("FAILED");
        throw error;
      }
    }

    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\nMigration failed: ${error.message}`);
  process.exit(1);
});
