#!/usr/bin/env node
/**
 * catalog:seed — backend §19's "static seed → DB → API" step.
 *
 * Imports the curated demo catalog (lib/data/products.ts) and writes it into
 * the database as products, marketplace listings, offers, and a demo price
 * series — so DATA_PROVIDER=db serves the exact catalog demo mode serves,
 * with source='demo' on every row and provider_id='demo-seed' on every
 * generated observation. Nothing here invents live data: these rows can never
 * masquerade as observations because provenance travels on the row.
 *
 * Idempotent by construction:
 *   - products/listings/offers upsert on their natural keys;
 *   - the demo series is deleted and rewritten, because buildHistory() is
 *     anchored to "today" and a re-run must replace, not append, its shifted
 *     copy beside the first.
 *
 * All writes run in one transaction: a failed seed leaves the catalog as it
 * was. Statements are batched (upsertProductsSql et al) because every round
 * trip over the wire costs more than the row work.
 *
 * Usage: npm run catalog:seed   (or: node scripts/seed.mjs)
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

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

// Node-loadable leaves: relative, extension-ful imports (products.ts header
// explains why) — no bundler aliases in the seed path.
const { products } = await import("../lib/data/products.ts");
const { stores } = await import("../lib/data/stores.ts");
const { toCents } = await import("../lib/db/money.ts");
const { INSERT_OBSERVATIONS_SQL } = await import("../lib/db/observation-queries.ts");
const {
  chunkRows,
  DELETE_DEMO_SERIES_SQL,
  listingIdsSql,
  listingRowsFor,
  offerRow,
  productRow,
  upsertListingsSql,
  upsertOffersSql,
  upsertProductsSql,
  upsertStoresSql,
  CATALOG_COUNTS_SQL,
  deriveExternalId,
} = await import("../lib/db/catalog-queries.ts");

/** Flatten row objects into the positional parameter array a batch needs. */
function flatten(rows, toParams) {
  const params = [];
  for (const row of rows) params.push(...toParams(row));
  return params;
}

const client = new Client({ connectionString: resolveConnectionString() });
await client.connect();

try {
  const started = Date.now();
  await client.query("BEGIN");

  // Stores first: offers/listings FK to them. Includes the `demo` pseudo-store
  // the generated series is attributed to — visibly not a retailer, so no
  // demo reading is ever implied to have come from a real store's listing.
  const storeRows = [...stores.map((store) => [store.id, store.name]), ["demo", "Sample data"]];
  for (const chunk of chunkRows(storeRows)) {
    await client.query(upsertStoresSql(chunk.length), flatten(chunk, (row) => row));
  }

  const productParams = products.map((product) => productRow(product, "demo"));
  for (const chunk of chunkRows(productParams)) {
    await client.query(upsertProductsSql(chunk.length), flatten(chunk, (row) => row));
  }

  // Listings: shared row builder (deduped by store+external — one URL is one
  // listing); ids fetched in one follow-up so offers can link to them (the §8
  // identity layer).
  const listingRows = listingRowsFor(products, "demo");
  for (const chunk of chunkRows(listingRows)) {
    await client.query(upsertListingsSql(chunk.length), flatten(chunk, (row) => row));
  }

  const pairParams = flatten(listingRows, (row) => [row[0], row[1]]);
  const listingIdByKey = new Map();
  for (const chunk of chunkRows(chunkRows(pairParams, 2), 2000)) {
    const flat = chunk.flat();
    const { rows } = await client.query(listingIdsSql(flat.length / 2), flat);
    for (const row of rows) listingIdByKey.set(`${row.store_id}\u0000${row.external_id}`, row.id);
  }

  const offerRows = [];
  let unlinked = 0;
  for (const product of products) {
    for (const offer of product.offers) {
      const external = deriveExternalId(offer.url, product.slug, offer.storeId);
      const listingId = listingIdByKey.get(`${offer.storeId}\u0000${external}`) ?? null;
      if (listingId === null) unlinked += 1;
      offerRows.push(offerRow(product, offer, listingId));
    }
  }
  for (const chunk of chunkRows(offerRows)) {
    await client.query(upsertOffersSql(chunk.length), flatten(chunk, (row) => row));
  }

  // Demo series: refresh-then-write, one statement, attributed to the demo
  // pseudo-store and provider 'demo-seed'.
  const slugs = products.map((product) => product.slug);
  await client.query(DELETE_DEMO_SERIES_SQL, [slugs]);

  const series = { slug: [], store: [], listing: [], price: [], availability: [], source: [], at: [], provider: [] };
  for (const product of products) {
    for (const point of product.priceHistory) {
      series.slug.push(product.slug);
      series.store.push("demo");
      // The demo pseudo-store has no marketplace listing — '' (unattributed)
      // is its identity, exactly as migration 0013 leaves pre-identity rows.
      series.listing.push("");
      series.price.push(toCents(point.price));
      series.availability.push("in_stock");
      series.source.push("demo");
      series.at.push(`${point.date}T12:00:00+00:00`);
      series.provider.push("demo-seed");
    }
  }
  const seriesCount = series.slug.length;
  for (let i = 0; i < seriesCount; i += 5000) {
    const slice = {
      slug: series.slug.slice(i, i + 5000),
      store: series.store.slice(i, i + 5000),
      listing: series.listing.slice(i, i + 5000),
      price: series.price.slice(i, i + 5000),
      availability: series.availability.slice(i, i + 5000),
      source: series.source.slice(i, i + 5000),
      at: series.at.slice(i, i + 5000),
      provider: series.provider.slice(i, i + 5000),
    };
    await client.query(INSERT_OBSERVATIONS_SQL, [
      slice.slug,
      slice.store,
      slice.listing,
      slice.price,
      slice.availability,
      slice.source,
      slice.at,
      slice.provider,
    ]);
  }

  await client.query("COMMIT");

  const { rows } = await client.query(CATALOG_COUNTS_SQL);
  const counts = rows[0];
  console.log(
    `Seeded ${products.length} products, ${offerRows.length} offers, ` +
      `${listingRows.length} listings, ${seriesCount} demo observations ` +
      `(${Date.now() - started}ms).`,
  );
  console.log(
    `Database now: ${counts.products} products, ${counts.offers} offers, ` +
      `${counts.listings} listings, ${counts.observations} observations ` +
      `(${counts.demo_series} demo-series).`,
  );
  if (unlinked > 0) {
    console.log(`WARNING: ${unlinked} offer(s) could not resolve a listing id.`);
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`Seed failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
