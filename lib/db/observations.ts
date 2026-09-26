import "server-only";

import type { BuyTiming, DataSource, Product } from "@/lib/types";
import type { PriceSeries } from "@/lib/data/observations";
import { getPriceSeries } from "@/lib/data/observations";
import { evaluateBuyTiming } from "@/lib/pricing";
import { query } from "@/lib/db";
import { toCents } from "@/lib/db/money";
import {
  INSERT_OBSERVATIONS_SQL,
  PRODUCT_SERIES_FOR_SLUGS_SQL,
  PRODUCT_SERIES_SQL,
} from "@/lib/db/observation-queries";
import { getDataSource } from "@/lib/data/observations";

/**
 * The observation store — the only place price history is *recorded* rather
 * than generated.
 *
 * Contract:
 *  - Append-only. Nothing is ever updated or deleted; the current price is the
 *    latest row, history is the series.
 *  - Every row carries the `source` it came from, so a generated reading can
 *    never be mistaken for an observed one even after both accumulate.
 *  - Money is written as integer centavos (lib/db/money.ts).
 *
 * The table stays empty until a provider that is allowed to report real prices
 * exists. Loading the sample catalog in here would produce a database full of
 * generated numbers wearing the costume of a price history — the exact failure
 * this module exists to prevent.
 */

export type ObservationInput = {
  productSlug: string;
  storeId: string;
  /**
   * The listing this reading came from — the marketplace's external id
   * (lib/data/listing-id.ts), or "" when no listing is known. Part of the
   * row's identity since migration 0013: two sellers of one product on one
   * marketplace are two observations, even at the same instant.
   */
  listingExternalId?: string;
  /** Price in pesos, matching the rest of the app. */
  price: number;
  /** ISO timestamp of when the price was actually observed. */
  observedAt: string;
  availability?: "in_stock" | "out_of_stock";
  source: DataSource;
  /** Who reported this reading — provenance, required by migration 0003. */
  providerId: string;
};

/**
 * Appends a batch of observations in one round trip.
 *
 * Callers go through `planIngestion()` (lib/data/ingest.ts) first: that is
 * where the decision to write at all is made. This function only records what
 * an authorized plan produced.
 *
 * Treat a failed write as "we lost a reading", never as a reason to surface an
 * error to a shopper.
 */
export async function recordObservations(
  inputs: readonly ObservationInput[],
): Promise<void> {
  if (inputs.length === 0) return;

  await query(INSERT_OBSERVATIONS_SQL, [
    inputs.map((item) => item.productSlug),
    inputs.map((item) => item.storeId),
    inputs.map((item) => item.listingExternalId ?? ""),
    inputs.map((item) => toCents(item.price)),
    inputs.map((item) => item.availability ?? "in_stock"),
    inputs.map((item) => item.source),
    inputs.map((item) => item.observedAt),
    inputs.map((item) => item.providerId),
  ]);
}

/**
 * The recorded history for a product, or null when nothing has been recorded.
 *
 * The series claims `live` only if every observation behind it is live — one
 * generated reading among real ones would taint the whole line, and
 * overstating the basis is the one direction this system must never err in.
 *
 * `allowDemo` decides whether the seed catalog's generated rows are visible
 * at all (Live Data Readiness §5): a live product reads only live readings,
 * so a failed or absent recording shows as *no history*, never as demo
 * history. Demo products keep reading everything, as before.
 */
export async function getProductSeries(
  productSlug: string,
  allowDemo: boolean = true,
): Promise<PriceSeries | null> {
  const rows = await query<{ date: string; price_cents: number; all_live: boolean }>(
    PRODUCT_SERIES_SQL,
    [productSlug, allowDemo],
  );

  if (rows.length === 0) return null;

  return {
    source: rows.every((row) => row.all_live) ? "live" : "demo",
    points: rows.map((row) => ({
      date: row.date,
      price: row.price_cents / 100,
    })),
  };
}

/** The empty series a live product answers with when nothing real is recorded. */
const EMPTY_SERIES: PriceSeries = { points: [], source: "demo" };

/**
 * The series a page should render.
 *
 * Recorded observations win outright when they exist: splicing generated
 * history onto the end of a real series would produce a line whose basis
 * changes half way along. When nothing is recorded — or the database is
 * unreachable — a DEMO product falls back to the catalog series, still tagged
 * with its own source, so the chart keeps labelling itself honestly either way.
 *
 * A LIVE product never takes that fallback (Live Data Readiness §5): its
 * generated catalog history is fiction, and fiction beside real current prices
 * is exactly the fake trend this module exists to prevent. It answers with an
 * empty series instead — "no recorded history" — and every surface downstream
 * (chart, verdict, recorded drop) already refuses to claim anything from an
 * empty line.
 *
 * Deliberately fails soft: an unavailable database must degrade a page, never
 * take down the build or the route that depends on it.
 */
export async function resolvePriceSeries(product: Product): Promise<PriceSeries> {
  const live = getDataSource(product) === "live";
  try {
    const recorded = await getProductSeries(product.slug, !live);
    if (recorded && recorded.points.length > 0) return recorded;
  } catch (error) {
    console.error(
      `Falling back to catalog price history for ${product.slug}:`,
      error instanceof Error ? error.message : error,
    );
  }
  if (live) return { ...EMPTY_SERIES };
  return getPriceSeries(product);
}

/**
 * Recorded series for a whole list of products in one query.
 *
 * Only slugs with recorded observations appear in the map — callers fall back
 * to the catalog series for the rest, exactly as `resolvePriceSeries` does for
 * a single product. Demo rows are passed only for slugs that are allowed to
 * read them (anything not fully live), so one statement serves a mixed list
 * while live products stay clear of the seed history (Live Data Readiness §5).
 * Fails soft for the same reason: an unavailable database must degrade a
 * list, never take down the page that renders it.
 */
export async function resolvePriceSeriesFor(
  products: readonly Product[],
): Promise<Map<string, PriceSeries>> {
  const series = new Map<string, PriceSeries>();
  const slugs = [...new Set(products.map((product) => product.slug))];
  if (slugs.length === 0) return series;
  const demoAllowed = products
    .filter((product) => getDataSource(product) !== "live")
    .map((product) => product.slug);

  try {
    const rows = await query<{
      product_slug: string;
      date: string;
      price_cents: number;
      all_live: boolean;
    }>(PRODUCT_SERIES_FOR_SLUGS_SQL, [slugs, demoAllowed]);

    for (const row of rows) {
      const existing = series.get(row.product_slug);
      const point = { date: row.date, price: row.price_cents / 100 };
      if (existing) {
        existing.points.push(point);
        // Overstating the basis is the one direction this must never err in.
        existing.source = existing.source === "live" && row.all_live ? "live" : "demo";
      } else {
        series.set(row.product_slug, {
          source: row.all_live ? "live" : "demo",
          points: [point],
        });
      }
    }
  } catch (error) {
    console.error(
      "Falling back to catalog price history for list results:",
      error instanceof Error ? error.message : error,
    );
  }

  return series;
}

/**
 * The buy-timing verdict for every product on a page, from recorded history
 * where it exists and the catalog series where it does not.
 *
 * List surfaces (category grids, related products, search results) used to
 * derive this straight from `product.priceHistory`, so they could disagree with
 * the product page the moment observations start accumulating. One batch keeps
 * every surface on the same series without one query per card.
 *
 * Keyed by slug so it survives being sent over the wire to the search client.
 */
export async function resolveBuyTimings(
  products: readonly Product[],
): Promise<Record<string, BuyTiming>> {
  const series = await resolvePriceSeriesFor(products);
  return Object.fromEntries(
    products.map((product) => [
      product.slug,
      evaluateBuyTiming(product, series.get(product.slug)?.points),
    ]),
  );
}
