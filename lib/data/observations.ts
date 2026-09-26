import type {
  DataSource,
  PriceObservation,
  PricePoint,
  Product,
  StoreOffer,
} from "@/lib/types";
import { deriveExternalId } from "./listing-id.ts";

/**
 * Current price and price history are deliberately separate concerns.
 *
 * - getCurrentObservations() → the latest reading per LISTING (what "now"
 *   costs at each seller)
 * - getPriceSeries()         → timestamped history (what it used to cost)
 *
 * Demo data produces source:"demo" readings; a live provider produces
 * source:"live" readings. Nothing downstream needs to change when real
 * data arrives — only the producer does.
 *
 * Observation identity is Product + Store + Listing, the canonical model
 * (Final Polish §3): two sellers of the same product on one marketplace are
 * two listings with their own URLs, so they get their own offer ids and their
 * own current observations — never one shared Product+Store identity.
 */

/**
 * One listing's identity inside a product: product + store + that listing's
 * external id, derived from its URL by the same rule migrations 0007/0011
 * store (`offers.external_id`). The same listing always maps to the same id;
 * a different seller's URL on the same store never does.
 */
export function getOfferId(
  productSlug: string,
  offer: Pick<StoreOffer, "storeId" | "url">,
): string {
  return `${productSlug}:${offer.storeId}:${deriveExternalId(
    offer.url,
    productSlug,
    offer.storeId,
  )}`;
}

/**
 * Source tag for a product's data, taken from its offers — conservatively.
 *
 * A product is only "live" when *every* offer backing it is live. One demo
 * offer, one unreadable source, or no offers at all means we do not know, and
 * "do not know" is reported as demo: a mixed Shopee-live / Lazada-demo product
 * must never be represented as live, because that single word is what the
 * sample labels, the structured data, and the SERP snippet all hang from.
 *
 * The alternative — reading the first offer — made the classification depend
 * on row order, so the same product could flip its answer between reads.
 */
export function getDataSource(product: Product): DataSource {
  if (product.offers.length === 0) return "demo";
  return product.offers.every((offer) => offer.source === "live") ? "live" : "demo";
}

/** Latest observation per listing — the product's current price state. */
export function getCurrentObservations(product: Product): PriceObservation[] {
  return product.offers.map((offer) => ({
    id: `${getOfferId(product.slug, offer)}@${offer.updatedAt}`,
    offerId: getOfferId(product.slug, offer),
    price: offer.price,
    observedAt: offer.updatedAt,
    availability: offer.inStock ? "in_stock" : "out_of_stock",
    source: offer.source,
  }));
}

export type PriceSeries = {
  points: PricePoint[];
  source: DataSource;
};

/** Timestamped price history, tagged with the source it came from. */
export function getPriceSeries(product: Product): PriceSeries {
  return { points: product.priceHistory, source: getDataSource(product) };
}

/** Newest reading across all of a product's listings. */
export function getNewestObservation(product: Product): PriceObservation | null {
  const observations = getCurrentObservations(product);
  if (observations.length === 0) return null;
  return observations.reduce((latest, observation) =>
    Date.parse(observation.observedAt) > Date.parse(latest.observedAt)
      ? observation
      : latest,
  );
}
