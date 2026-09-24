"use client";

import { useMemo, useState } from "react";
import type { Product, SearchFilters, SearchSort } from "@/lib/types";
import { searchProducts, getBrands, isProductUrl } from "@/lib/data/search";
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

export function SearchResults({ initialQuery }: { initialQuery: string }) {
  const [query] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>({ inStockOnly: true });
  const [sort, setSort] = useState<SearchSort>("lowest-price");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const pasted = isProductUrl(query);

  const results = useMemo(
    () => searchProducts(query, filters, sort),
    [query, filters, sort],
  );

  function update<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
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
              {getBrands().map((brand) => (
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
            {results.length} {results.length === 1 ? "result" : "results"}
            {pasted && " for your pasted link"}
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

        {results.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {results.map((product: Product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
