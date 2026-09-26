import type { PricePoint, Product, StoreOffer, BuyTiming } from "@/lib/types";
import { getDataSource, getPriceSeries, type PriceSeries } from "@/lib/data/observations";
import { isSafeRedirectUrl } from "@/lib/api/affiliate";
import { getFreshness, isCurrentFreshness } from "@/lib/utils/freshness";
import { formatPeso } from "@/lib/utils/format";

export type HistoryRange = "7D" | "30D" | "3M" | "6M";

const RANGE_DAYS: Record<HistoryRange, number> = {
  "7D": 7,
  "30D": 30,
  "3M": 90,
  "6M": 180,
};

/**
 * Why one offer may not claim this product's current price. Every state is a
 * statement about the data, never about how good the deal looks.
 */
export type OfferExclusion =
  | "invalid_url"
  | "invalid_price"
  | "different_variant"
  | "bundle"
  | "out_of_stock"
  | "stale";

/**
 * The single authority on "is this a valid current offer" — the funnel every
 * claim about a lowest price goes through, defined once so no API route,
 * component, or sort can re-implement it and drift.
 *
 *   all offers
 *      → valid URL          (we can only send a shopper somewhere safe)
 *      → valid price        (a price of 0 or NaN is not a price)
 *      → right product      (a bundle or another variant is not this product)
 *      → available          (an out-of-stock listing cannot be bought now)
 *      → fresh enough       (checked inside the freshness window)
 *      → eligible
 *
 * Returns null when the offer passes, or the reason it does not — callers
 * that only need the boolean use `isEligibleCurrentOffer`.
 */
export function checkOfferEligible(
  offer: StoreOffer,
  now: number = Date.now(),
): OfferExclusion | null {
  if (!offer.url || !isSafeRedirectUrl(offer.url)) return "invalid_url";
  if (!Number.isFinite(offer.price) || offer.price <= 0) return "invalid_price";
  if (offer.condition === "different_variant") return "different_variant";
  if (offer.condition === "bundle") return "bundle";
  if (!offer.inStock) return "out_of_stock";
  if (!isCurrentFreshness(getFreshness(offer.updatedAt, now))) return "stale";
  return null;
}

export function isEligibleCurrentOffer(offer: StoreOffer, now: number = Date.now()): boolean {
  return checkOfferEligible(offer, now) === null;
}

/**
 * The offers a "lowest price right now" may be computed from.
 *
 * A stale offer may still be listed — as history, clearly labelled — but it
 * must not win the ranking merely by being cheaper than a price checked this
 * morning. When nothing survives the funnel the product has no current lowest
 * price, and callers must say so rather than fall back to the cheapest stale
 * number they can find.
 */
export function getEligibleCurrentOffers(
  offers: StoreOffer[],
  now: number = Date.now(),
): StoreOffer[] {
  return offers.filter((offer) => isEligibleCurrentOffer(offer, now));
}

export function getLowestOffer(offers: StoreOffer[]): StoreOffer | null {
  const eligible = getEligibleCurrentOffers(offers);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, offer) => (offer.price < best.price ? offer : best));
}

export function getHighestPrice(offers: StoreOffer[]): number {
  if (offers.length === 0) return 0;
  return Math.max(...offers.map((offer) => offer.price));
}

/**
 * Savings compare like with like: the best eligible price against the worst
 * one a shopper could actually buy today. Against an out-of-stock or stale
 * listing the "you could save" figure would promise a comparison that does
 * not exist.
 */
export function getSavings(offers: StoreOffer[]): number {
  const eligible = getEligibleCurrentOffers(offers);
  if (eligible.length < 2) return 0;
  return getHighestPrice(eligible) - getLowestOffer(eligible)!.price;
}

export function getAverage(history: PricePoint[]): number {
  if (history.length === 0) return 0;
  const sum = history.reduce((acc, point) => acc + point.price, 0);
  return Math.round(sum / history.length);
}

export function filterHistory(history: PricePoint[], range: HistoryRange): PricePoint[] {
  const count = RANGE_DAYS[range];
  if (history.length <= count) return history;
  return history.slice(history.length - count);
}

export function getLowestInWindow(history: PricePoint[], range: HistoryRange): number {
  const window = filterHistory(history, range);
  if (window.length === 0) return 0;
  return Math.min(...window.map((point) => point.price));
}

/**
 * Derived metrics for a window of price history — everything needed to
 * explain a buy-timing verdict or a price drop from actual observations.
 */
export type WindowStats = {
  range: HistoryRange;
  current: number;
  lowest: number;
  highest: number;
  average: number;
  /** Negative = current price sits below the window average. */
  percentVsAverage: number;
  /** How far current price is above the window low, in %. 0 = at the low. */
  percentAboveLowest: number;
  /** Change across the window, first reading → current. Negative = fell. */
  changePercent: number;
  points: PricePoint[];
};

export function getWindowStats(
  history: PricePoint[],
  current: number,
  range: HistoryRange,
): WindowStats {
  const points = filterHistory(history, range);
  const lowest = points.length ? Math.min(...points.map((p) => p.price)) : 0;
  const highest = points.length ? Math.max(...points.map((p) => p.price)) : 0;
  const average = getAverage(points);
  const first = points.length ? points[0].price : 0;

  const pct = (value: number, base: number) =>
    base === 0 ? 0 : Math.round(((value - base) / base) * 100);

  return {
    range,
    current,
    lowest,
    highest,
    average,
    percentVsAverage: pct(current, average),
    percentAboveLowest: pct(current, lowest),
    changePercent: pct(current, first),
    points,
  };
}

/**
 * Below this many readings, the window statistics describe noise rather than a
 * pattern. The engine refuses to render a verdict instead of guessing — a
 * "fair price" computed from three points is a claim the data cannot support.
 */
export const MIN_TIMING_OBSERVATIONS = 14;

const DAY_MS = 86_400_000;

/**
 * Names the span a window actually covers, so the copy never claims more
 * history than exists. Most products carry ~90+ daily readings and keep the
 * familiar "90-day average"; a product recorded for 40 days says 40.
 *
 * Assumes ascending, daily-spaced points — both the catalog series and
 * getProductSeries() return them that way.
 */
function describeWindow(points: PricePoint[]): string {
  const first = points.length > 0 ? Date.parse(`${points[0].date}T00:00:00Z`) : NaN;
  const last =
    points.length > 0 ? Date.parse(`${points[points.length - 1].date}T00:00:00Z`) : NaN;
  if (Number.isNaN(first) || Number.isNaN(last)) return "recorded";

  const days = Math.max(2, Math.round((last - first) / DAY_MS) + 1);
  return days >= 85 ? "90-day" : `${days}-day`;
}

/**
 * @param history Optional series to judge against. Defaults to the product's
 *                catalog history; callers holding recorded observations pass
 *                theirs in so the verdict describes real data. A LIVE product
 *                gets no default at all (Live Data Readiness §5): its catalog
 *                history is generated, and a verdict computed from fiction
 *                beside live prices is the fake trend this engine refuses to
 *                make — an empty series just reads "not enough history".
 */
export function evaluateBuyTiming(product: Product, history?: PricePoint[]): BuyTiming {
  const lowest = getLowestOffer(product.offers);
  const current = lowest?.price ?? 0;
  const points =
    history ??
    (getDataSource(product) === "live" ? [] : getPriceSeries(product).points);

  // No eligible offer means there is no current price to judge. A verdict
  // computed against 0 would read "100% below average" — the most flattering
  // possible lie — so the engine declines instead.
  if (!lowest) {
    return {
      status: "fair",
      label: "Current price unavailable",
      detail:
        "None of this product's listings has a fresh, in-stock price we can " +
        "confirm right now, so there is nothing to compare with its history.",
      percentVsAverage: 0,
      insufficient: true,
    };
  }

  if (points.length < MIN_TIMING_OBSERVATIONS) {
    return {
      status: "fair",
      label: "Not enough history yet",
      detail:
        `Only ${points.length} price observation${points.length === 1 ? "" : "s"} ` +
        `recorded — we need ${MIN_TIMING_OBSERVATIONS} before comparing today's ` +
        `price with its usual range.`,
      percentVsAverage: 0,
      insufficient: true,
    };
  }

  const stats = getWindowStats(points, current, "3M");
  const percentVsAverage = stats.percentVsAverage;
  const window = describeWindow(stats.points);

  if (percentVsAverage <= -8) {
    return {
      status: "good",
      label: "Good time to buy",
      detail: `Price is ${Math.abs(percentVsAverage)}% below its ${window} average.`,
      percentVsAverage,
    };
  }

  if (percentVsAverage <= 5) {
    return {
      status: "fair",
      label: "Fair price",
      detail: "Price is close to its usual range.",
      percentVsAverage,
    };
  }

  // Deliberately describes only what the window shows. "Has recently increased"
  // would be a separate claim, and a price above its average has not always
  // risen to get there.
  return {
    status: "wait",
    label: "Consider waiting",
    detail: `Price is ${percentVsAverage}% above its ${window} average.`,
    percentVsAverage,
  };
}

/**
 * The catalog's reference-price drop — the sample's "was ₱X, now ₱Y".
 *
 * This is a demo figure and callers must present it as one. It refuses to
 * answer for live-sourced products: beside real prices a catalog
 * `previousPrice` is a number nobody observed, so once a provider reports
 * live offers the drop has to come from `getRecordedPriceDrop` instead.
 */
export function getPriceDropPercent(product: Product): number | null {
  if (!product.previousPrice) return null;
  if (getDataSource(product) === "live") return null;
  const lowest = getLowestOffer(product.offers);
  if (!lowest) return null;
  return Math.round(((product.previousPrice - lowest.price) / product.previousPrice) * 100);
}

export type RecordedDrop = {
  /** The reading the price fell from, as recorded. */
  previousPrice: number;
  /** The price being compared against it. */
  currentPrice: number;
  /** How far it fell, in pesos. */
  absoluteDrop: number;
  /** How far it fell, in percent of the previous reading. */
  percentageDrop: number;
  /** The date of that previous reading, "YYYY-MM-DD". */
  observedAt: string;
  /** "Down ₱2,000 vs previous recorded price" */
  detail: string;
  /** "Down 8% from 30-day average" — null unless enough readings exist to claim it. */
  averageDetail: string | null;
};

/**
 * A price drop derived from recorded observations — never from a listed
 * "previous" price. This is the only place a drop may be claimed from.
 *
 * Returns null in every case where the data cannot support the claim:
 *  - the series is not entirely live (one generated reading would make the
 *    comparison meaningless),
 *  - fewer than two readings (a drop needs something to have fallen from),
 *  - the current price is not below the last recorded one (nothing fell).
 *
 * When the newest reading *is* the current price, the comparison steps back
 * one reading so the sentence compares like with like.
 */
export function getRecordedPriceDrop(
  series: PriceSeries,
  currentPrice: number,
): RecordedDrop | null {
  if (series.source !== "live") return null;
  if (currentPrice <= 0) return null;

  const points = series.points;
  if (points.length < 2) return null;

  const newest = points[points.length - 1];
  const previous = points[points.length - 2];
  if (!newest || !previous) return null;

  const baseline = newest.price === currentPrice ? previous : newest;
  if (baseline.price <= currentPrice) return null;

  const absoluteDrop = baseline.price - currentPrice;
  const percentageDrop = Math.round((absoluteDrop / baseline.price) * 100);

  const stats = getWindowStats(points, currentPrice, "30D");
  const averageDetail =
    stats.points.length >= MIN_TIMING_OBSERVATIONS && stats.percentVsAverage <= -1
      ? `Down ${Math.abs(stats.percentVsAverage)}% from ${describeWindow(stats.points)} average`
      : null;

  return {
    previousPrice: baseline.price,
    currentPrice,
    absoluteDrop,
    percentageDrop,
    observedAt: baseline.date,
    detail: `Down ${formatPeso(absoluteDrop)} vs previous recorded price`,
    averageDetail,
  };
}
