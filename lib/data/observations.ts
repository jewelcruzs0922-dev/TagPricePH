import type {
  DataSource,
  PriceObservation,
  PricePoint,
  Product,
} from "@/lib/types";

/**
 * Current price and price history are deliberately separate concerns.
 *
 * - getCurrentObservations() → the latest reading per offer (what "now" costs)
 * - getPriceSeries()         → timestamped history (what it used to cost)
 *
 * Demo data produces source:"demo" readings; a live provider produces
 * source:"live" readings. Nothing downstream needs to change when real
 * data arrives — only the producer does.
 */

export function getOfferId(productSlug: string, storeId: string): string {
  return `${productSlug}:${storeId}`;
}

/** Source tag for a product's data, taken from its offers. */
export function getDataSource(product: Product): DataSource {
  return product.offers[0]?.source ?? "demo";
}

/** Latest observation per offer — the product's current price state. */
export function getCurrentObservations(product: Product): PriceObservation[] {
  return product.offers.map((offer) => ({
    id: `${getOfferId(product.slug, offer.storeId)}@${offer.updatedAt}`,
    offerId: getOfferId(product.slug, offer.storeId),
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

/** Newest reading across all of a product's offers. */
export function getNewestObservation(product: Product): PriceObservation | null {
  const observations = getCurrentObservations(product);
  if (observations.length === 0) return null;
  return observations.reduce((latest, observation) =>
    Date.parse(observation.observedAt) > Date.parse(latest.observedAt)
      ? observation
      : latest,
  );
}
