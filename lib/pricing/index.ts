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

export function evaluateBuyTiming(product: Product): BuyTiming {
  const lowest = getLowestOffer(product.offers);
  const current = lowest?.price ?? 0;
  const { points } = getPriceSeries(product);
  const stats = getWindowStats(points, current, "3M");
  const percentVsAverage = stats.percentVsAverage;

  if (percentVsAverage <= -8) {
    return {
      status: "good",
      label: "Good time to buy",
      detail: `Price is ${Math.abs(percentVsAverage)}% below its 90-day average.`,
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

  return {
    status: "wait",
    label: "Consider waiting",
    detail: "Price has recently increased and is above its usual range.",
    percentVsAverage,
  };
}

export function getPriceDropPercent(product: Product): number | null {
  if (!product.previousPrice) return null;
  const lowest = getLowestOffer(product.offers);
  if (!lowest) return null;
  return Math.round(((product.previousPrice - lowest.price) / product.previousPrice) * 100);
}
