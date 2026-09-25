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
 */
export async function getProductSeries(
  productSlug: string,
): Promise<PriceSeries | null> {
  const rows = await query<{ date: string; price_cents: number; all_live: boolean }>(
    PRODUCT_SERIES_SQL,
    [productSlug],
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

/**
 * The series a page should render.
 *
 * Recorded observations win outright when they exist: splicing generated
 * history onto the end of a real series would produce a line whose basis
 * changes half way along. When nothing is recorded — or the database is
 * unreachable — the catalog series is returned still tagged with its own
 * source, so the chart keeps labelling itself honestly either way.
 *
 * Deliberately fails soft: an unavailable database must degrade a page, never
 * take down the build or the route that depends on it.
 */
export async function resolvePriceSeries(product: Product): Promise<PriceSeries> {
  try {
    const recorded = await getProductSeries(product.slug);
    if (recorded && recorded.points.length > 0) return recorded;
  } catch (error) {
    console.error(
      `Falling back to catalog price history for ${product.slug}:`,
      error instanceof Error ? error.message : error,
    );
  }
  return getPriceSeries(product);
}

/**
 * Recorded series for a whole list of products in one query.
 *
 * Only slugs with recorded observations appear in the map — callers fall back
 * to the catalog series for the rest, exactly as `resolvePriceSeries` does for
 * a single product. Fails soft for the same reason: an unavailable database
 * must degrade a list, never take down the page that renders it.
 */
export async function resolvePriceSeriesFor(
  products: readonly Product[],
): Promise<Map<string, PriceSeries>> {
  const series = new Map<string, PriceSeries>();
  const slugs = [...new Set(products.map((product) => product.slug))];
  if (slugs.length === 0) return series;

  try {
    const rows = await query<{
      product_slug: string;
      date: string;
      price_cents: number;
      all_live: boolean;
    }>(PRODUCT_SERIES_FOR_SLUGS_SQL, [slugs]);

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
