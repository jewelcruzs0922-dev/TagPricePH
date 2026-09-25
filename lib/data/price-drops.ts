import "server-only";

import type { Product } from "@/lib/types";
import type { RecordedDrop } from "@/lib/pricing";
import {
  getLowestOffer,
  getPriceDropPercent,
  getRecordedPriceDrop,
} from "@/lib/pricing";
import { resolvePriceSeriesFor } from "@/lib/db/observations";

/**
 * The price-drop feed — one definition, used by both the /price-drops page
 * and the homepage's drop row, so the two can never disagree about what a
 * "drop" is.
 *
 * Precedence, strictly:
 *
 *  1. verified drops — current price below the product's most recent *recorded*
 *     observation, from `getRecordedPriceDrop`, which only ever answers from a
 *     series of real readings;
 *  2. sample drops — the demo catalog's `previousPrice` reference, which
 *     exists only while the catalog itself is sample data and is labelled as
 *     such by every surface that shows it;
 *  3. nothing.
 *
 * There is no third data source. A listed "was" price on a live product is
 * marketing copy somebody typed, not an observation, and it never becomes a
 * drop.
 */
export type PriceDropFeed = {
  /** Products to show, strongest drop first. */
  products: Product[];
  /** Verified drops keyed by slug; absent means the sample reference price. */
  recorded: Map<string, RecordedDrop>;
  /** True when every claim in the feed comes from recorded observations. */
  hasRecorded: boolean;
};

export async function buildPriceDropFeed(
  products: readonly Product[],
): Promise<PriceDropFeed> {
  const seriesBySlug = await resolvePriceSeriesFor(products);

  const verified: { product: Product; drop: RecordedDrop }[] = [];
  for (const product of products) {
    const series = seriesBySlug.get(product.slug);
    const lowest = getLowestOffer(product.offers);
    if (!series || !lowest) continue;
    const drop = getRecordedPriceDrop(series, lowest.price);
    if (drop) verified.push({ product, drop });
  }
  verified.sort((a, b) => b.drop.percentageDrop - a.drop.percentageDrop);

  const recorded = new Map(verified.map((entry) => [entry.product.slug, entry.drop]));
  const hasRecorded = verified.length > 0;

  const sample = products
    .map((product) => ({ product, drop: getPriceDropPercent(product) ?? 0 }))
    .filter((entry) => entry.drop > 0)
    .sort((a, b) => b.drop - a.drop);

  const feed = hasRecorded
    ? verified.map((entry) => entry.product)
    : sample.map((entry) => entry.product);

  return { products: feed, recorded, hasRecorded };
}
