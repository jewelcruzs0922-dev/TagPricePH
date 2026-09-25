import type { PricePoint, Product, StoreOffer, BuyTiming } from "@/lib/types";
import { getPriceSeries } from "@/lib/data/observations";

export type HistoryRange = "7D" | "30D" | "3M" | "6M";

const RANGE_DAYS: Record<HistoryRange, number> = {
  "7D": 7,
  "30D": 30,
  "3M": 90,
  "6M": 180,
};

export function getLowestOffer(offers: StoreOffer[]): StoreOffer | null {
  if (offers.length === 0) return null;
  return offers.reduce((best, offer) => (offer.price < best.price ? offer : best));
}

export function getHighestPrice(offers: StoreOffer[]): number {
  if (offers.length === 0) return 0;
  return Math.max(...offers.map((offer) => offer.price));
}

export function getSavings(offers: StoreOffer[]): number {
  const lowest = getLowestOffer(offers);
  if (!lowest) return 0;
  return getHighestPrice(offers) - lowest.price;
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
 *                theirs in so the verdict describes real data.
 */
export function evaluateBuyTiming(product: Product, history?: PricePoint[]): BuyTiming {
  const lowest = getLowestOffer(product.offers);
  const current = lowest?.price ?? 0;
  const points = history ?? getPriceSeries(product).points;

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

export function getPriceDropPercent(product: Product): number | null {
  if (!product.previousPrice) return null;
  const lowest = getLowestOffer(product.offers);
  if (!lowest) return null;
  return Math.round(((product.previousPrice - lowest.price) / product.previousPrice) * 100);
}
