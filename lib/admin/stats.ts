import "server-only";

import { DEMO_MODE } from "@/lib/config";
import {
  getActiveProvider,
  getActiveProviderId,
  getRegisteredProviderIds,
  probeProvider,
} from "@/lib/api/registry";
import { categories } from "@/lib/data/categories";
import { products } from "@/lib/data/products";
import { stores } from "@/lib/data/stores";
import { query } from "@/lib/db";
import { getFreshness } from "@/lib/utils/freshness";

/**
 * Read-only figures for the admin dashboard. Every number comes from the
 * catalog seeds or the database as it actually is — nothing here synthesises,
 * extrapolates, or invents a value. The observation queue sitting at zero is
 * reported as zero, with the reason, because no authorized provider exists yet.
 *
 * This is Phase 25's list: product status (catalog), offer status + last
 * checked + stale offers (freshness), failed providers (per-provider probe),
 * product matching issues and price anomalies (computed over the recorded
 * series — honest counts, flagged not hidden).
 */

export type ProviderStatus = {
  id: string;
  usable: boolean;
  reason: string | null;
};

export type FreshnessCounts = {
  fresh: number;
  stale: number;
  unavailable: number;
  /** Oldest last-checked stamp across every offer, ISO or null. */
  oldest: string | null;
};

export type AdminStats = {
  provider: {
    demoMode: boolean;
    activeId: string;
    registeredIds: string[];
    usable: boolean;
    reason: string | null;
  };
  /** Every registered provider probed — this is the failed-providers list. */
  providers: ProviderStatus[];
  catalog: {
    products: number;
    offers: number;
    categories: number;
    stores: number;
    historyRows: number;
    productsWithoutHistory: number;
  };
  freshness: FreshnessCounts;
  /** Sample-history points that jumped more than 50% day over day. */
  anomalies: number;
  observations: { total: number; latest: string | null };
  alerts: { total: number; active: number; triggered: number; cancelled: number };
  clicks: number;
  views: number;
};

type CountRow = { total: number };
type ObservationRow = { total: number; latest: Date | string | null };
type AlertStatusRow = { status: string; total: number };

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function providerStatus(): AdminStats["provider"] {
  let usable = true;
  let reason: string | null = null;
  try {
    getActiveProvider();
  } catch (error) {
    usable = false;
    reason = error instanceof Error ? error.message : String(error);
  }
  return {
    demoMode: DEMO_MODE,
    activeId: getActiveProviderId(),
    registeredIds: getRegisteredProviderIds(),
    usable,
    reason,
  };
}

/** Probe every registered provider — unavailable ones show with their reason. */
function providerList(): ProviderStatus[] {
  return getRegisteredProviderIds().map((id) => ({ id, ...probeProvider(id) }));
}

function catalogCounts(): AdminStats["catalog"] {
  let offers = 0;
  let historyRows = 0;
  let productsWithoutHistory = 0;
  for (const product of products) {
    offers += product.offers.length;
    historyRows += product.priceHistory.length;
    if (product.priceHistory.length === 0) productsWithoutHistory += 1;
  }
  return {
    products: products.length,
    offers,
    categories: categories.length,
    stores: stores.length,
    historyRows,
    productsWithoutHistory,
  };
}

/** Offer status by freshness: how much of the catalog is past its window. */
function freshnessCounts(): FreshnessCounts {
  const counts: FreshnessCounts = { fresh: 0, stale: 0, unavailable: 0, oldest: null };
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const product of products) {
    for (const offer of product.offers) {
      counts[getFreshness(offer.updatedAt)] += 1;
      const parsed = Date.parse(offer.updatedAt);
      if (!Number.isNaN(parsed) && parsed < oldestMs) oldestMs = parsed;
    }
  }
  counts.oldest = Number.isFinite(oldestMs) ? new Date(oldestMs).toISOString() : null;
  return counts;
}

/** Day-over-day moves beyond 50% in the recorded sample series — flagged, not hidden. */
function anomalyCount(): number {
  let anomalies = 0;
  for (const product of products) {
    const series = product.priceHistory;
    for (let i = 1; i < series.length; i += 1) {
      const previous = series[i - 1].price;
      if (previous <= 0) continue;
      const change = Math.abs(series[i].price - previous) / previous;
      if (change > 0.5) anomalies += 1;
    }
  }
  return anomalies;
}

export async function loadAdminStats(): Promise<AdminStats> {
  const [observationRows, alertRows, clickRows, viewRows] = await Promise.all([
    query<ObservationRow>(
      "SELECT COUNT(*)::int AS total, MAX(observed_at) AS latest FROM price_observations",
    ),
    query<AlertStatusRow>(
      "SELECT status, COUNT(*)::int AS total FROM price_alerts GROUP BY status",
    ),
    query<CountRow>("SELECT COUNT(*)::int AS total FROM click_events"),
    query<CountRow>("SELECT COUNT(*)::int AS total FROM page_views"),
  ]);

  const alerts = { total: 0, active: 0, triggered: 0, cancelled: 0 };
  for (const row of alertRows) {
    alerts.total += row.total;
    if (row.status === "active") alerts.active = row.total;
    else if (row.status === "triggered") alerts.triggered = row.total;
    else if (row.status === "cancelled") alerts.cancelled = row.total;
  }

  const observations = observationRows[0] ?? { total: 0, latest: null };

  return {
    provider: providerStatus(),
    providers: providerList(),
    catalog: catalogCounts(),
    freshness: freshnessCounts(),
    anomalies: anomalyCount(),
    observations: {
      total: observations.total,
      latest: toIso(observations.latest),
    },
    alerts,
    clicks: clickRows[0]?.total ?? 0,
    views: viewRows[0]?.total ?? 0,
  };
}
