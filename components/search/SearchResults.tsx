"use client";

import { useEffect, useRef, useState } from "react";
import type { BuyTiming, Product, SearchFilters, SearchSort } from "@/lib/types";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "@/lib/data/search-core";
import { buildSearchUrl } from "@/lib/data/search-url";
import { categories } from "@/lib/data/categories";
import { stores } from "@/lib/data/stores";
import { ProductCard } from "@/components/products/ProductCard";
import { EmptyState } from "@/components/ui/States";
import { ChevronDown, ChevronUp } from "lucide-react";

const sorts: { value: SearchSort; label: string }[] = [
  { value: "lowest-price", label: "Lowest price" },
  { value: "biggest-savings", label: "Biggest savings" },
  { value: "biggest-drop", label: "Biggest price drop" },
  { value: "recently-updated", label: "Recently updated" },
];

const FETCH_DEBOUNCE_MS = 250;

type Phase = "idle" | "loading" | "error";

export function SearchResults({
  initialQuery,
  initialResults,
  initialNote,
  initialTimings,
  initialTotal,
  brands,
}: {
  initialQuery: string;
  /** Already filtered server-side, so the first paint needs no round trip. */
  initialResults: Product[];
  /** How the server read the query (pasted links), shown above the results. */
  initialNote: string | null;
  /**
   * Verdict per product slug, computed server-side from the recorded series so
   * these cards say the same thing the product page would.
   */
  initialTimings?: Record<string, BuyTiming>;
  /**
   * Size of the full result set. The client only ever holds a window of it —
   * `initialResults` for the first paint and one more window per "Show more" —
   * so the catalog itself never has to fit in the page.
   */
  initialTotal: number;
  /** Facet options for the brand filter, computed server-side. */
  brands: string[];
}) {
  const [query] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SearchSort>(DEFAULT_SORT);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [results, setResults] = useState<Product[]>(initialResults);
  const [total, setTotal] = useState(initialTotal);
  const [note, setNote] = useState<string | null>(initialNote);
  const [timings, setTimings] = useState<Record<string, BuyTiming>>(
    initialTimings ?? {},
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [loadingMore, setLoadingMore] = useState(false);

  const requestId = useRef(0);
  const skipFirstFetch = useRef(true);
  const pageRef = useRef(1);
  /** The in-flight "Show more" request, so a filter change or an unmount can
   *  cancel it instead of letting a stale page download into nothing. */
  const loadMoreAbort = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      loadMoreAbort.current?.abort();
    },
    [],
  );

  // Filters and sort are applied on the server. Each change issues one debounced
  // request; a stale response can never overwrite a newer one.
  useEffect(() => {
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false;
      return;
    }

    loadMoreAbort.current?.abort();
    loadMoreAbort.current = null;

    const id = requestId.current + 1;
    requestId.current = id;
    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      setPhase("loading");

      fetch(buildSearchUrl(query, filters, sort), { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return (await response.json()) as {
            results: Product[];
            note: string | null;
            timings?: Record<string, BuyTiming>;
            total?: number;
          };
        })
        .then((data) => {
          if (id !== requestId.current) return;
          setResults(data.results);
          setTotal(data.total ?? data.results.length);
          setNote(data.note);
          setTimings(data.timings ?? {});
          pageRef.current = 1;
          setLoadingMore(false);
          setPhase("idle");
        })
        .catch(() => {
          if (controller.signal.aborted || id !== requestId.current) return;
          setPhase("error");
          setLoadingMore(false);
        });
    }, FETCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, filters, sort]);

  function update<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * Fetch the next window and append it. Shares `requestId` with the filter
   * effect so whichever request the user started last is the one that lands:
   * a filter change supersedes a pending "Show more", never the reverse —
   * and a load more is refused outright while a filter fetch is in flight, so
   * an old page can never be appended to a new result set.
   */
  async function loadMore() {
    if (phase !== "idle" || loadingMore) return;
    const id = requestId.current + 1;
    requestId.current = id;
    const controller = new AbortController();
    loadMoreAbort.current = controller;
    setLoadingMore(true);
    try {
      const response = await fetch(
        buildSearchUrl(query, filters, sort, pageRef.current + 1),
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as {
        results: Product[];
        note: string | null;
        timings?: Record<string, BuyTiming>;
        total?: number;
        page?: number;
      };
      if (id !== requestId.current) return;
      setResults((prev) => [...prev, ...data.results]);
      setTimings((prev) => ({ ...prev, ...(data.timings ?? {}) }));
      setTotal(data.total ?? 0);
      setNote(data.note);
      pageRef.current = data.page ?? pageRef.current + 1;
    } catch {
      // Keep what is on screen; the button stays available to retry.
    } finally {
      if (loadMoreAbort.current === controller) loadMoreAbort.current = null;
      if (requestId.current === id) setLoadingMore(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      {/* Wrapper (not the button) carries the responsive hide: .btn-ghost sets
          an unlayered display that would otherwise beat Tailwind's lg:hidden
          and steal column 1 of the grid above. */}
      <div className="lg:hidden">
        <button
          type="button"
          className="btn-ghost w-full justify-between"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((value) => !value)}
        >
          Filters
          {filtersOpen ? (
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <aside
        aria-label="Filters"
        className={`${filtersOpen ? "block" : "hidden"} lg:block lg:sticky lg:top-24 lg:self-start`}
      >
        <div className="card space-y-5 p-4">
          <div>
            <label htmlFor="filter-category" className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              Category
            </label>
            <select
              id="filter-category"
              className="h-11 w-full rounded-xl border border-line bg-white px-3 text-[16px] text-ink outline-none focus:border-ink"
              value={filters.category ?? ""}
              onChange={(event) => update("category", event.target.value || undefined)}
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-brand" className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              Brand
            </label>
            <select
              id="filter-brand"
              className="h-11 w-full rounded-xl border border-line bg-white px-3 text-[16px] text-ink outline-none focus:border-ink"
              value={filters.brand ?? ""}
              onChange={(event) => update("brand", event.target.value || undefined)}
            >
              <option value="">All brands</option>
              {brands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-store" className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              Store
            </label>
            <select
              id="filter-store"
              className="h-11 w-full rounded-xl border border-line bg-white px-3 text-[16px] text-ink outline-none focus:border-ink"
              value={filters.store ?? ""}
              onChange={(event) => update("store", event.target.value || undefined)}
            >
              <option value="">All stores</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-price" className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              Max price
            </label>
            <div className="flex items-center rounded-xl border border-line bg-white px-3 focus-within:border-ink">
              <span className="text-ink-3">₱</span>
              <input
                id="filter-price"
                type="number"
                min={0}
                inputMode="numeric"
                className="h-11 w-full bg-transparent px-2 text-[16px] text-ink outline-none"
                value={filters.maxPrice ?? ""}
                onChange={(event) =>
                  update(
                    "maxPrice",
                    event.target.value ? Number(event.target.value) : undefined,
                  )
                }
              />
            </div>
          </div>

          <div className="space-y-1 pt-1">
            <label className="flex cursor-pointer items-center gap-3 py-2.5 text-[16px] text-ink">
              <input
                type="checkbox"
                checked={Boolean(filters.priceDropOnly)}
                onChange={(event) => update("priceDropOnly", event.target.checked || undefined)}
                className="h-4 w-4 accent-[#172033]"
              />
              Price drop only
            </label>
            <label className="flex cursor-pointer items-center gap-3 py-2.5 text-[16px] text-ink">
              <input
                type="checkbox"
                checked={Boolean(filters.inStockOnly)}
                onChange={(event) => update("inStockOnly", event.target.checked || undefined)}
                className="h-4 w-4 accent-[#172033]"
              />
              In stock
            </label>
          </div>
        </div>
      </aside>

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] text-ink-2" aria-live="polite">
            {total} {total === 1 ? "result" : "results"}
            {phase === "loading" && " · updating…"}
          </p>
          <div className="flex items-center gap-2">
            <label htmlFor="sort-by" className="text-[14px] text-ink-2">
              Sort by
            </label>
            <select
              id="sort-by"
              className="h-11 rounded-xl border border-line bg-white px-3 text-[16px] font-semibold text-ink outline-none focus:border-ink"
              value={sort}
              onChange={(event) => setSort(event.target.value as SearchSort)}
            >
              {sorts.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {note && (
          <div className="mb-4 rounded-xl border border-line bg-accent-soft px-4 py-3 text-[15px] text-ink-2">
            {note}
          </div>
        )}

        {phase === "error" && (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-[#B54708]/30 bg-[#B54708]/10 px-4 py-3 text-[15px] text-[#B54708]"
          >
            Couldn’t refresh results from the server. Showing the last results we
            loaded.
          </p>
        )}

        {results.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {results.map((product: Product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  timing={timings[product.slug]}
                />
            ))}
          </div>
        )}

        {results.length > 0 && results.length < total && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore || phase !== "idle"}
              className="btn-ghost px-6 disabled:opacity-60"
            >
              {loadingMore
                ? "Loading…"
                : `Show more (${total - results.length} more)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
