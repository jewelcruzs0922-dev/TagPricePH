import type { Metadata } from "next";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { AdminLogout } from "@/components/admin/AdminLogout";
import { isAdminAuthenticated } from "@/lib/admin/session";
import { loadAdminStats, type AdminStats } from "@/lib/admin/stats";

export const dynamic = "force-dynamic";

/**
 * The operator dashboard. Gated by the admin session cookie: without it this
 * route renders only the login form, so no figure below ever reaches an
 * unauthenticated caller. It is noindexed and disallowed in robots.txt, and
 * no public page links to it.
 *
 * Every value is read-only and comes from the catalog seeds or the database
 * as it stands — the observation queue is reported at its real count (the
 * seeded demo history, plus whatever an authorized provider has ingested)
 * rather than dressed up.
 */
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-ink">{value}</div>
    </div>
  );
}

function Section({
  title,
  adminKey,
  children,
}: {
  title: string;
  adminKey: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5 sm:p-6" data-admin={adminKey}>
      <h2 className="mb-4 text-lg font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function RankList({
  items,
  emptyLabel,
}: {
  items: { label: string; total: number }[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-3">{emptyLabel}</p>;
  }
  return (
    <ol className="space-y-1.5">
      {items.map((item, index) => (
        <li
          key={item.label}
          className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2 text-sm"
        >
          <span className="min-w-0 truncate text-ink">
            <span className="mr-2 text-ink-3">{index + 1}.</span>
            {item.label}
          </span>
          <span className="shrink-0 font-semibold text-ink-2">{item.total}</span>
        </li>
      ))}
    </ol>
  );
}

function Dashboard({ stats }: { stats: AdminStats }) {
  return (
    <div data-admin="dashboard" className="space-y-6">
      <Section title="Provider status" adminKey="provider">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              Active provider
            </dt>
            <dd className="text-ink">{stats.provider.activeId}</dd>
          </div>
          <div>
            <dt className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              Demo catalog
            </dt>
            <dd className="text-ink">{stats.provider.demoMode ? "On" : "Off"}</dd>
          </div>
          <div>
            <dt className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              Registered providers
            </dt>
            <dd className="text-ink">{stats.provider.registeredIds.join(", ")}</dd>
          </div>
          <div>
            <dt className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              Usable right now
            </dt>
            <dd className={stats.provider.usable ? "text-ink" : "text-wait"}>
              {stats.provider.usable ? "Yes" : "No"}
            </dd>
          </div>
        </dl>
        {stats.provider.reason ? (
          <p className="mt-3 rounded-xl bg-accent-panel px-4 py-3 text-sm text-ink-3">
            {stats.provider.reason}
          </p>
        ) : null}
        <ul className="mt-3 space-y-2">
          {stats.providers.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-line bg-white px-4 py-3 text-sm">
              <span className="font-semibold text-ink">{entry.id}</span>
              {entry.id === stats.provider.activeId ? (
                <span className="ml-2 text-[13px] text-ink-3">(active)</span>
              ) : null}
              <span className={entry.usable ? "ml-2 text-success" : "ml-2 text-wait"}>
                {entry.usable ? "usable" : "unavailable"}
              </span>
              {entry.reason ? <p className="mt-1 text-ink-3">{entry.reason}</p> : null}
            </li>
          ))}
        </ul>
        {stats.provider.demoMode ? (
          <p className="mt-3 text-sm text-ink-3">
            Sample catalog — no marketplace credentials are configured yet.
          </p>
        ) : null}
      </Section>

      <Section title="Catalog" adminKey="catalog">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Products" value={stats.catalog.products} />
          <Stat label="Offers" value={stats.catalog.offers} />
          <Stat label="Stores" value={stats.catalog.stores} />
          <Stat label="Categories" value={stats.catalog.categories} />
          <Stat label="History rows" value={stats.catalog.historyRows} />
          <Stat
            label="Products without history"
            value={stats.catalog.productsWithoutHistory}
          />
        </div>
      </Section>

      <Section title="Offer freshness" adminKey="freshness">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Fresh (≤48h)" value={stats.freshness.fresh} />
          <Stat label="Aging (≤14d)" value={stats.freshness.aging} />
          <Stat label="Stale (>14d)" value={stats.freshness.stale} />
          <Stat label="Unknown timestamp" value={stats.freshness.unknown} />
          <Stat
            label="Oldest checked"
            value={
              stats.freshness.oldest
                ? new Date(stats.freshness.oldest).toLocaleDateString("en-PH", {
                    dateStyle: "medium",
                  })
                : "None"
            }
          />
        </div>
        <p className="mt-3 text-sm text-ink-3">
          Thresholds come from lib/utils/freshness.ts and are configurable per
          provider cadence. Stale and undated offers are never counted in a
          current-price ranking — they are shown as history, clearly labelled.
        </p>
      </Section>

      <Section title="Data quality" adminKey="quality">
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="Sample-history spikes (>50% day moves)" value={stats.anomalies} />
          <Stat
            label="Catalog source"
            value={stats.provider.demoMode ? "Sample (demo)" : "Live"}
          />
        </div>
        <ul className="mt-3 space-y-1 text-sm text-ink-3">
          <li>
            Ingestion screening is active: non-positive prices, future
            timestamps, duplicate rows, and moves beyond 85% against the last
            recorded observation are refused before any row is written.
          </li>
          <li>
            Matching issues are computed per lookup (the refuse/ambiguous
            contract) — none are stored, so there is nothing to list until a
            matcher issue store exists.
          </li>
        </ul>
      </Section>

      <Section title="Price observations" adminKey="observations">
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="Recorded" value={stats.observations.total} />
          <Stat
            label="Most recent"
            value={
              stats.observations.latest
                ? new Date(stats.observations.latest).toLocaleString("en-PH", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "None"
            }
          />
        </div>
        <p className="mt-3 text-sm text-ink-3">
          Every row here carries its provenance: the seeded demo history
          (source demo, provider demo-seed), plus any readings an authorized
          provider has ingested. Nothing is synthesised at request time.
        </p>
      </Section>

      <Section title="Price alerts" adminKey="alerts">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Total" value={stats.alerts.total} />
          <Stat label="Active" value={stats.alerts.active} />
          <Stat label="Triggered" value={stats.alerts.triggered} />
          <Stat label="Cancelled" value={stats.alerts.cancelled} />
        </div>
        <p className="mt-3 text-sm text-ink-3">
          Emails are identities for finding alerts across devices — nothing is
          sent anywhere.
        </p>
      </Section>

      <Section title="Engagement" adminKey="engagement">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Outbound clicks" value={stats.clicks} />
          <Stat label="Product views" value={stats.views} />
          <Stat label="Searches" value={stats.searches.total} />
        </div>
        <p className="mt-3 text-sm text-ink-3">
          Funnel so far: search → product view → outbound click. Counts are
          lifetime totals from page_views, click_events, and search_queries.
        </p>
      </Section>

      <Section title="Top searches" adminKey="searches">
        <RankList
          items={stats.searches.top.map((row) => ({
            label: row.query,
            total: row.total,
          }))}
          emptyLabel="No searches recorded yet."
        />
      </Section>

      <Section title="Most viewed products" adminKey="top-products">
        <RankList
          items={stats.topProducts.map((row) => ({
            label: row.slug,
            total: row.total,
          }))}
          emptyLabel="No product views recorded yet."
        />
      </Section>

      <Section title="Clicks by store" adminKey="clicks-by-store">
        <RankList
          items={stats.clicksByStore.map((row) => ({
            label: row.store,
            total: row.total,
          }))}
          emptyLabel="No outbound clicks recorded yet."
        />
      </Section>
    </div>
  );
}

export default async function AdminPage() {
  if (!(await isAdminAuthenticated())) {
    return <AdminLogin />;
  }

  let stats: AdminStats | null = null;
  let loadError: string | null = null;
  try {
    stats = await loadAdminStats();
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-ink">Admin</h1>
        <AdminLogout />
      </div>
      {stats ? (
        <Dashboard stats={stats} />
      ) : (
        <div className="card border-wait/40 p-5" data-admin="error">
          <h2 className="text-lg font-bold text-ink">Dashboard unavailable</h2>
          <p className="mt-2 text-sm text-ink-3">{loadError}</p>
        </div>
      )}
    </div>
  );
}
